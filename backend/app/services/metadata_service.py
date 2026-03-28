from collections.abc import Callable
from dataclasses import dataclass, field

import musicbrainzngs

musicbrainzngs.set_useragent("ToneAdjust", "1.0", "https://github.com/toneadjust")


@dataclass
class MemberInfo:
    name: str
    instruments: list[str] = field(default_factory=list)


@dataclass
class SongMetadata:
    title:       str | None
    year:        int | None
    album:       str | None
    artist_name: str | None
    genres:      list[str]      = field(default_factory=list)
    labels:      list[str]      = field(default_factory=list)
    members:     list[MemberInfo] = field(default_factory=list)


def fetch_metadata(
    artist: str,
    song: str,
    on_log: Callable[[str], None] | None = None,
) -> SongMetadata:
    def log(msg: str) -> None:
        if on_log:
            on_log(msg)

    title       = None
    year        = None
    album       = None
    artist_name = None
    genres:  list[str]       = []
    labels:  list[str]       = []
    members: list[MemberInfo] = []

    # ── 1. Search recording ────────────────────────────────────────────────────
    log("Recherche de l'enregistrement sur MusicBrainz...")
    try:
        result = musicbrainzngs.search_recordings(
            recording=song, artist=artist, limit=5
        )
        recordings = result.get("recording-list", [])
    except Exception as e:
        log(f"[error] Impossible de contacter MusicBrainz : {e}")
        return SongMetadata(title=title, year=year, album=album, artist_name=artist_name)

    if not recordings:
        log("Aucun enregistrement trouvé.")
        return SongMetadata(title=title, year=year, album=album, artist_name=artist_name)

    rec = recordings[0]
    title = rec.get("title")
    log(f"Enregistrement trouvé : {title}")

    # ── 2. Release (album + labels) ────────────────────────────────────────────
    releases = rec.get("release-list", [])
    release_id = None
    if releases:
        release_id = releases[0].get("id")
        album = releases[0].get("title")
        date  = releases[0].get("date", "")
        if date:
            try:
                year = int(date[:4])
            except ValueError:
                pass

    if release_id:
        log(f"Récupération des détails de l'album...")
        try:
            rel_data = musicbrainzngs.get_release_by_id(
                release_id, includes=["labels"]
            )
            rel = rel_data.get("release", {})
            album = rel.get("title", album)
            date  = rel.get("date", "")
            if date:
                try:
                    year = int(date[:4])
                except ValueError:
                    pass
            labels = [
                li["label"]["name"]
                for li in rel.get("label-info-list", [])
                if li.get("label", {}).get("name")
            ]
            log(f"Album : {album} ({year})  ·  Labels : {', '.join(labels) or 'N/A'}")
        except Exception as e:
            log(f"[warning] Détails album indisponibles : {e}")

    # ── 3. Artist (name + members + genres) ───────────────────────────────────
    credits = rec.get("artist-credit", [])
    artist_id = None
    if credits and isinstance(credits[0], dict):
        artist_id   = credits[0].get("artist", {}).get("id")
        artist_name = credits[0].get("artist", {}).get("name", artist)

    if artist_id:
        log(f"Récupération des informations sur l'artiste : {artist_name}...")
        try:
            art_data = musicbrainzngs.get_artist_by_id(
                artist_id, includes=["artist-rels", "tags"]
            )
            art = art_data.get("artist", {})

            # Genres from tags (sorted by vote count)
            tags = art.get("tag-list", [])
            genres = [
                t["name"]
                for t in sorted(tags, key=lambda x: -int(x.get("count", 0)))
            ][:15]
            if genres:
                log(f"Genres : {', '.join(genres[:6])}")

            # Members from artist relations
            for rel in art.get("artist-relation-list", []):
                if (
                    rel.get("type") == "member of band"
                    and rel.get("direction") == "backward"
                ):
                    member_name  = rel.get("artist", {}).get("name", "")
                    instruments  = rel.get("attribute-list", [])
                    if member_name:
                        members.append(MemberInfo(name=member_name, instruments=instruments))

            if members:
                summary = ", ".join(
                    f"{m.name} ({', '.join(m.instruments)})" if m.instruments else m.name
                    for m in members[:5]
                )
                log(f"Membres : {summary}")
                if len(members) > 5:
                    log(f"  … et {len(members) - 5} autres")

        except Exception as e:
            log(f"[warning] Informations artiste indisponibles : {e}")

    return SongMetadata(
        title=title,
        year=year,
        album=album,
        artist_name=artist_name,
        genres=genres,
        labels=labels,
        members=members,
    )
