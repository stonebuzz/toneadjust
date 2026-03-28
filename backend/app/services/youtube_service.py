import os
import re
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

import yt_dlp

_HERE = Path(__file__).resolve().parent.parent.parent  # backend/
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", str(_HERE.parent / "downloads"))).resolve()

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(text: str) -> str:
    return _ANSI.sub("", text).strip()


def _sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip()


@dataclass
class VideoResult:
    rank: int
    title: str
    channel: str
    duration: str
    thumbnail: str
    video_url: str


def search_youtube(artist: str, song: str) -> list[VideoResult]:
    query = f"ytsearch5:{artist} {song}"
    ydl_opts = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(query, download=False)

    results = []
    for i, entry in enumerate(info.get("entries", []), start=1):
        duration_s = entry.get("duration") or 0
        minutes, seconds = divmod(int(duration_s), 60)
        results.append(
            VideoResult(
                rank=i,
                title=entry.get("title", ""),
                channel=entry.get("channel") or entry.get("uploader", ""),
                duration=f"{minutes}:{seconds:02d}",
                thumbnail=entry.get("thumbnail") or f"https://i.ytimg.com/vi/{entry.get('id', '')}/hqdefault.jpg",
                video_url=entry.get("url") or f"https://www.youtube.com/watch?v={entry.get('id', '')}",
            )
        )
    return results


def _cookies_opts() -> dict:
    """Retourne les options cookies pour contourner la protection anti-bot de YouTube."""
    browser = os.getenv("YTDLP_COOKIES_BROWSER", "")
    if browser:
        return {"cookiesfrombrowser": (browser,)}
    import shutil
    if shutil.which("google-chrome") or shutil.which("chromium"):
        return {"cookiesfrombrowser": ("chrome",)}
    if shutil.which("firefox"):
        return {"cookiesfrombrowser": ("firefox",)}
    return {}


def download_audio(
    video_url: str,
    mb_recording_id: str,
    on_log: Callable[[str], None] | None = None,
) -> Path:
    audio_dir = DOWNLOAD_DIR / mb_recording_id / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    output_template = str(audio_dir / "audio.%(ext)s")

    def _emit(msg: str) -> None:
        if on_log and (clean := _strip_ansi(msg)):
            on_log(clean)

    class _Logger:
        def debug(self, msg: str) -> None:
            # Skip yt-dlp's very verbose internal [debug] lines
            if msg.startswith("[debug]"):
                return
            _emit(msg)

        def info(self, msg: str) -> None:
            _emit(msg)

        def warning(self, msg: str) -> None:
            _emit(f"[warning] {msg}")

        def error(self, msg: str) -> None:
            _emit(f"[error] {msg}")

    def _progress_hook(d: dict) -> None:
        if not on_log:
            return
        status = d.get("status")
        if status == "downloading":
            pct   = _strip_ansi(d.get("_percent_str", "?%"))
            size  = _strip_ansi(d.get("_total_bytes_str") or d.get("_total_bytes_estimate_str") or "?")
            speed = _strip_ansi(d.get("_speed_str") or "?")
            eta   = _strip_ansi(d.get("_eta_str") or "?")
            on_log(f"[download]  {pct}  ·  {size}  ·  {speed}  ·  ETA {eta}")
        elif status == "finished":
            fname = Path(d.get("filename", "")).name
            on_log(f"[download]  Fichier reçu : {fname} — conversion en wav...")
        elif status == "error":
            on_log(f"[error]  Échec du téléchargement")

    ydl_opts = {
        "format": "bestaudio/bestvideo/best",
        "outtmpl": output_template,
        "quiet": False,
        "no_warnings": False,
        "logger": _Logger(),
        "progress_hooks": [_progress_hook],
        "extractor_args": {"youtube": {"player_client": ["tv", "web"]}},
        "js_runtimes": {"node": {}},
        "postprocessors": [
            {
                "key": "FFmpegExtractAudio",
                "preferredcodec": "wav",
            }
        ],
        **_cookies_opts(),
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        ydl.download([video_url])

    return audio_dir / "audio.wav"
