import asyncio
import json
import shutil
from pathlib import Path

import httpx
from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from sqlalchemy import text

from app.database import (
    AsyncSessionLocal, get_song_by_mb_id, list_songs,
    song_to_dict, upsert_song_by_mb_id, upsert_song_relations,
)
from app.services.audio_processor import DOWNLOAD_DIR, separate_stems
from app.services.guitar_analyzer import analysis_to_dict, analyze_guitar
from app.services.musicbrainz_search_service import search_recordings
from app.services.youtube_service import download_audio, search_youtube

router = APIRouter()


# ── Request models ─────────────────────────────────────────────────────────────

class TrackSearchRequest(BaseModel):
    artist: str
    title: str


class YoutubeSearchRequest(BaseModel):
    artist: str
    song: str


class AnalyzeRequest(BaseModel):
    mb_recording_id: str
    artist: str
    song: str
    video_url: str
    title: str | None = None
    album: str | None = None
    year: int | None = None
    genres: list[str] = []


class TabSearchRequest(BaseModel):
    artist: str
    title: str


class TabDownloadRequest(BaseModel):
    url: str


_GP_EXTENSIONS = {".gp", ".gp3", ".gp4", ".gp5", ".gpx"}


def _tab_dir(mb_recording_id: str) -> Path:
    return DOWNLOAD_DIR / mb_recording_id / "tab"


def _find_tab_file(mb_recording_id: str) -> Path | None:
    tab_dir = _tab_dir(mb_recording_id)
    if not tab_dir.exists():
        return None
    for f in tab_dir.iterdir():
        if f.suffix.lower() in _GP_EXTENSIONS:
            return f
    return None


# ── Song list ──────────────────────────────────────────────────────────────────

@router.get("/songs")
async def get_songs():
    songs = await list_songs()
    return {"songs": [song_to_dict(s) for s in songs]}


@router.get("/songs/{mb_recording_id}")
async def get_song_detail(mb_recording_id: str):
    song = await get_song_by_mb_id(mb_recording_id)
    if not song:
        raise HTTPException(status_code=404, detail="Song not found")
    return {"song": song_to_dict(song)}


# ── MusicBrainz track search ───────────────────────────────────────────────────

@router.post("/track-search")
async def track_search(req: TrackSearchRequest):
    recordings = await asyncio.to_thread(search_recordings, req.artist, req.title)
    result = []
    for r in recordings:
        existing = await get_song_by_mb_id(r.id)
        result.append({
            "id":               r.id,
            "title":            r.title,
            "artist":           r.artist,
            "album":            r.album,
            "year":             r.year,
            "duration_ms":      r.duration_ms,
            "disambiguation":   r.disambiguation,
            "thumb_url":        r.thumb_url,
            "genres":           r.genres,
            "already_processed": bool(existing and existing.stems_dir),
        })
    return {"recordings": result}


# ── YouTube search ─────────────────────────────────────────────────────────────

@router.post("/youtube-search")
async def youtube_search(req: YoutubeSearchRequest):
    results = await asyncio.to_thread(search_youtube, req.artist, req.song)
    return {
        "results": [
            {
                "rank":      r.rank,
                "title":     r.title,
                "channel":   r.channel,
                "duration":  r.duration,
                "thumbnail": r.thumbnail,
                "video_url": r.video_url,
            }
            for r in results
        ]
    }


# ── Admin ──────────────────────────────────────────────────────────────────────

@router.post("/admin/clear-db")
async def admin_clear_db():
    """Delete all rows from all tables without dropping them."""
    async with AsyncSessionLocal() as session:
        for tbl in [
            "song_genres", "song_labels", "song_members", "member_instruments",
            "songs", "genres", "labels", "members", "instruments",
        ]:
            await session.execute(text(f"DELETE FROM {tbl}"))
        await session.commit()
    return {"status": "ok"}


@router.post("/admin/clear-downloads")
async def admin_clear_downloads():
    """Delete everything inside the downloads directory."""
    if DOWNLOAD_DIR.exists():
        shutil.rmtree(DOWNLOAD_DIR)
        DOWNLOAD_DIR.mkdir(parents=True, exist_ok=True)
    return {"status": "ok"}


# ── Tab (Guitar Pro) endpoints ─────────────────────────────────────────────────

@router.get("/tab/{mb_recording_id}")
async def get_tab_info(mb_recording_id: str):
    tab_file = _find_tab_file(mb_recording_id)
    if not tab_file:
        return {"exists": False}
    return {
        "exists": True,
        "filename": tab_file.name,
        "url": f"/api/tab/{mb_recording_id}/file",
    }


@router.get("/tab/{mb_recording_id}/file")
async def get_tab_file(mb_recording_id: str):
    tab_file = _find_tab_file(mb_recording_id)
    if not tab_file:
        raise HTTPException(status_code=404, detail="No tab file found")
    return FileResponse(
        tab_file,
        media_type="application/octet-stream",
        filename=tab_file.name,
    )


@router.post("/tab/{mb_recording_id}/upload")
async def upload_tab(mb_recording_id: str, file: UploadFile = File(...)):
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in _GP_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Format non supporté: {suffix}. Formats acceptés: {', '.join(_GP_EXTENSIONS)}")

    tab_dir = _tab_dir(mb_recording_id)
    tab_dir.mkdir(parents=True, exist_ok=True)

    # Remove any existing tab file
    for existing in tab_dir.iterdir():
        if existing.suffix.lower() in _GP_EXTENSIONS:
            existing.unlink()

    dest = tab_dir / (file.filename or f"tab{suffix}")
    content = await file.read()
    dest.write_bytes(content)

    return {"filename": dest.name, "url": f"/api/tab/{mb_recording_id}/file"}


@router.post("/tab/{mb_recording_id}/search")
async def search_tab(mb_recording_id: str, req: TabSearchRequest):
    query = f"{req.artist} {req.title} guitar pro tab"
    results = []
    try:
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Accept-Language": "en-US,en;q=0.9",
        }
        resp = await asyncio.to_thread(
            lambda: httpx.get(
                "https://html.duckduckgo.com/html/",
                params={"q": query},
                headers=headers,
                timeout=10,
                follow_redirects=True,
            )
        )
        text_content = resp.text
        # Extract links that end with GP extensions
        import re
        # Find anchor href links
        links = re.findall(r'href=["\']([^"\']+)["\']', text_content)
        titles = re.findall(r'<a[^>]+class=["\'][^"\']*result__a[^"\']*["\'][^>]*>([^<]+)</a>', text_content)

        seen = set()
        title_iter = iter(titles)
        for link in links:
            # DuckDuckGo wraps URLs in redirect — extract uddg param
            uddg_match = re.search(r'uddg=([^&"\']+)', link)
            if uddg_match:
                import urllib.parse
                link = urllib.parse.unquote(uddg_match.group(1))

            ext_match = re.search(r'\.(gp[x345]?)\b', link, re.IGNORECASE)
            if not ext_match:
                continue
            if link in seen:
                continue
            seen.add(link)

            ext = ext_match.group(1).lower()
            title = next(title_iter, link.split("/")[-1])
            results.append({"title": title, "url": link, "ext": ext})

            if len(results) >= 10:
                break
    except Exception:
        pass

    return {"results": results}


@router.post("/tab/{mb_recording_id}/download")
async def download_tab(mb_recording_id: str, req: TabDownloadRequest):
    url = req.url
    suffix = Path(url.split("?")[0]).suffix.lower()
    if suffix not in _GP_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Format non supporté: {suffix}")

    try:
        resp = await asyncio.to_thread(
            lambda: httpx.get(url, timeout=15, follow_redirects=True, headers={
                "User-Agent": "Mozilla/5.0"
            })
        )
        resp.raise_for_status()
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Erreur de téléchargement: {e}")

    tab_dir = _tab_dir(mb_recording_id)
    tab_dir.mkdir(parents=True, exist_ok=True)

    # Remove any existing tab file
    for existing in tab_dir.iterdir():
        if existing.suffix.lower() in _GP_EXTENSIONS:
            existing.unlink()

    filename = url.split("/")[-1].split("?")[0] or f"tab{suffix}"
    dest = tab_dir / filename
    dest.write_bytes(resp.content)

    return {"filename": dest.name, "url": f"/api/tab/{mb_recording_id}/file"}


# ── SSE helper ─────────────────────────────────────────────────────────────────

def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


# ── Analyze pipeline ───────────────────────────────────────────────────────────

@router.post("/analyze")
async def analyze(req: AnalyzeRequest):
    async def stream():
        mb_recording_id = req.mb_recording_id
        artist = req.artist
        song = req.song
        video_url = req.video_url

        # ── Download ──────────────────────────────────────────────────────────
        yield _sse("progress", {"step": "download", "status": "processing"})
        try:
            loop = asyncio.get_running_loop()
            log_queue: asyncio.Queue[str] = asyncio.Queue()

            def on_log_dl(message: str) -> None:
                loop.call_soon_threadsafe(log_queue.put_nowait, message)

            dl_task = asyncio.ensure_future(
                asyncio.to_thread(download_audio, video_url, mb_recording_id, on_log_dl)
            )

            while not dl_task.done():
                try:
                    msg = await asyncio.wait_for(log_queue.get(), timeout=0.3)
                    yield _sse("log", {"step": "download", "message": msg})
                except asyncio.TimeoutError:
                    pass

            while not log_queue.empty():
                yield _sse("log", {"step": "download", "message": log_queue.get_nowait()})

            audio_path = await dl_task
            await upsert_song_by_mb_id(
                mb_recording_id,
                artist=artist, song=song,
                title=req.title, album=req.album, year=req.year,
                artist_name=artist,
                youtube_url=video_url, audio_path=str(audio_path),
            )
            if req.genres:
                await upsert_song_relations(
                    artist, song,
                    genres=req.genres, labels=[], members=[],
                    mb_recording_id=mb_recording_id,
                )
            yield _sse("progress", {"step": "download", "status": "done", "audio_path": str(audio_path)})
        except Exception as e:
            yield _sse("error", {"step": "download", "message": str(e)})
            return

        # ── Demucs ────────────────────────────────────────────────────────────
        yield _sse("progress", {"step": "demucs", "status": "processing"})
        try:
            loop = asyncio.get_running_loop()
            demucs_queue: asyncio.Queue[str] = asyncio.Queue()

            def on_log_demucs(message: str) -> None:
                loop.call_soon_threadsafe(demucs_queue.put_nowait, message)

            demucs_task = asyncio.ensure_future(
                asyncio.to_thread(separate_stems, audio_path, mb_recording_id, on_log_demucs)
            )

            while not demucs_task.done():
                try:
                    msg = await asyncio.wait_for(demucs_queue.get(), timeout=0.3)
                    yield _sse("log", {"step": "demucs", "message": msg})
                except asyncio.TimeoutError:
                    pass

            while not demucs_queue.empty():
                yield _sse("log", {"step": "demucs", "message": demucs_queue.get_nowait()})

            stems = await demucs_task
            stems_dir = str(stems["guitar"].parent)
            await upsert_song_by_mb_id(mb_recording_id, stems_dir=stems_dir)
            yield _sse("progress", {
                "step": "demucs", "status": "done",
                "stems": {k: str(v) for k, v in stems.items()},
            })
        except Exception as e:
            yield _sse("error", {"step": "demucs", "message": str(e)})
            return

        # ── Guitar analysis ───────────────────────────────────────────────────
        yield _sse("progress", {"step": "analysis", "status": "processing"})
        try:
            loop = asyncio.get_running_loop()
            analysis_queue: asyncio.Queue[str] = asyncio.Queue()

            def on_log_analysis(message: str) -> None:
                loop.call_soon_threadsafe(analysis_queue.put_nowait, message)

            analysis_task = asyncio.ensure_future(
                asyncio.to_thread(analyze_guitar, stems["guitar"], on_log_analysis)
            )

            while not analysis_task.done():
                try:
                    msg = await asyncio.wait_for(analysis_queue.get(), timeout=0.3)
                    yield _sse("log", {"step": "analysis", "message": msg})
                except asyncio.TimeoutError:
                    pass

            while not analysis_queue.empty():
                yield _sse("log", {"step": "analysis", "message": analysis_queue.get_nowait()})

            analysis = await analysis_task
            analysis_dict = analysis_to_dict(analysis)
            await upsert_song_by_mb_id(mb_recording_id, analysis_json=json.dumps(analysis_dict))
            yield _sse("progress", {"step": "analysis", "status": "done", "analysis": analysis_dict})
        except Exception as e:
            yield _sse("error", {"step": "analysis", "message": str(e)})
            return

        # ── Result ────────────────────────────────────────────────────────────
        final = await get_song_by_mb_id(mb_recording_id)
        yield _sse("result", {"song": song_to_dict(final)})

    return StreamingResponse(stream(), media_type="text/event-stream")
