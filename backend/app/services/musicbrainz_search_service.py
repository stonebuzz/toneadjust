from dataclasses import dataclass

import httpx

_MB_BASE = "https://musicbrainz.org/ws/2"
_HEADERS = {"User-Agent": "ToneAdjust/1.0 (https://github.com/toneadjust)"}


@dataclass
class MBRecording:
    id: str
    title: str
    artist: str
    album: str | None
    year: int | None
    duration_ms: int | None
    disambiguation: str | None
    release_id: str | None
    thumb_url: str | None  # Cover Art Archive redirect URL
    genres: list[str]      = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.genres is None:
            self.genres = []


def _best_release(releases: list[dict]) -> dict | None:
    if not releases:
        return None

    def _score(r: dict) -> tuple:
        status = (r.get("status") or "").lower()
        rg = r.get("release-group") or {}
        primary = (rg.get("primary-type") or "").lower()
        secondary = [s.lower() for s in rg.get("secondary-types") or []]
        is_official = status == "official"
        is_album = primary == "album"
        is_live = "live" in secondary

        # Lower tuple value = higher priority
        if is_official and is_album and not is_live:
            tier = 0
        elif is_official and not is_live:
            tier = 1
        elif is_official:
            tier = 2
        else:
            tier = 3

        date = r.get("date") or "9999"
        return (tier, date)

    return min(releases, key=_score)


def search_recordings(artist: str, title: str, limit: int = 15) -> list[MBRecording]:
    query = (
        f'title:"{title}~" AND artist:"{artist}~"'
        " AND status:official"
        " AND NOT secondarytype:live"
        " AND NOT comment:live*"
    )
    try:
        resp = httpx.get(
            f"{_MB_BASE}/recording/",
            params={"query": query, "fmt": "json", "limit": limit, "inc": "tags"},
            headers=_HEADERS,
            timeout=10,
        )
        resp.raise_for_status()
        data = resp.json()
    except Exception:
        return []

    recordings = []
    for rec in data.get("recordings") or []:
        score = rec.get("score") or 0
        if int(score) < 85:
            continue

        title_str = rec.get("title") or ""
        disambiguation = rec.get("disambiguation") or None

        # Skip live/demo recordings
        disam_lower = (disambiguation or "").lower()
        if "live" in disam_lower or "demo" in disam_lower:
            continue

        # Artist credit
        credits = rec.get("artist-credit") or []
        artist_str = credits[0].get("name") or credits[0].get("artist", {}).get("name", "") if credits else ""

        # Duration
        duration_ms = rec.get("length") or None

        # First release date → year
        first_date = rec.get("first-release-date") or ""
        year: int | None = None
        if first_date and len(first_date) >= 4:
            try:
                year = int(first_date[:4])
            except ValueError:
                pass

        # Best release — prefer Official, fall back to any
        all_releases = rec.get("releases") or []
        official_releases = [
            r for r in all_releases
            if (r.get("status") or "").lower() == "official"
        ]
        releases = official_releases if official_releases else all_releases
        best = _best_release(releases) if releases else None
        release_id = best["id"] if best else None
        album = best.get("title") if best else None
        thumb_url = f"https://coverartarchive.org/release/{release_id}/front" if release_id else None

        # Genres from recording tags (sorted by vote count)
        tags = rec.get("tags") or []
        genres = [
            t["name"] for t in sorted(tags, key=lambda x: -int(x.get("count", 0)))
        ][:10]

        recordings.append(MBRecording(
            id=rec.get("id") or "",
            title=title_str,
            artist=artist_str,
            album=album,
            year=year,
            duration_ms=duration_ms,
            disambiguation=disambiguation,
            release_id=release_id,
            thumb_url=thumb_url,
            genres=genres,
        ))

    return recordings
