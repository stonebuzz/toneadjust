import json
import os
from datetime import datetime

from sqlalchemy import (
    Column, DateTime, ForeignKey, Integer, String, Table, Text,
    insert, select, text,
)
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import DeclarativeBase, relationship, selectinload

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite+aiosqlite:///./toneadjust.db")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionLocal = async_sessionmaker(engine, expire_on_commit=False)


class Base(DeclarativeBase):
    pass


# ── Association tables ─────────────────────────────────────────────────────────

song_genres_table = Table(
    "song_genres", Base.metadata,
    Column("song_id",  ForeignKey("songs.id",   ondelete="CASCADE"), primary_key=True),
    Column("genre_id", ForeignKey("genres.id",  ondelete="CASCADE"), primary_key=True),
)

song_labels_table = Table(
    "song_labels", Base.metadata,
    Column("song_id",  ForeignKey("songs.id",   ondelete="CASCADE"), primary_key=True),
    Column("label_id", ForeignKey("labels.id",  ondelete="CASCADE"), primary_key=True),
)

song_members_table = Table(
    "song_members", Base.metadata,
    Column("song_id",   ForeignKey("songs.id",    ondelete="CASCADE"), primary_key=True),
    Column("member_id", ForeignKey("members.id",  ondelete="CASCADE"), primary_key=True),
)

member_instruments_table = Table(
    "member_instruments", Base.metadata,
    Column("member_id",     ForeignKey("members.id",     ondelete="CASCADE"), primary_key=True),
    Column("instrument_id", ForeignKey("instruments.id", ondelete="CASCADE"), primary_key=True),
)


# ── Reference models ───────────────────────────────────────────────────────────

class Genre(Base):
    __tablename__ = "genres"
    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)


class Label(Base):
    __tablename__ = "labels"
    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)


class Instrument(Base):
    __tablename__ = "instruments"
    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)


class Member(Base):
    __tablename__ = "members"
    id   = Column(Integer, primary_key=True, autoincrement=True)
    name = Column(String, nullable=False, unique=True)
    instruments = relationship("Instrument", secondary=member_instruments_table)


# ── Song ───────────────────────────────────────────────────────────────────────

class Song(Base):
    __tablename__ = "songs"

    id             = Column(Integer, primary_key=True, autoincrement=True)
    mb_recording_id = Column(String, unique=True, index=True)
    artist         = Column(String, nullable=False, index=True)
    song           = Column(String, nullable=False, index=True)
    youtube_url    = Column(String)
    title          = Column(String)
    year           = Column(Integer)
    album          = Column(String)
    artist_name    = Column(String)
    bpm            = Column(Integer)
    audio_path     = Column(String)
    stems_dir      = Column(String)
    analysis_json  = Column(Text)
    created_at     = Column(DateTime, default=datetime.utcnow)

    genres  = relationship("Genre",  secondary=song_genres_table)
    labels  = relationship("Label",  secondary=song_labels_table)
    members = relationship("Member", secondary=song_members_table)


# ── DB init ────────────────────────────────────────────────────────────────────

async def init_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Migrations : add new columns to existing tables if they don't exist yet
        for col_sql in [
            "ALTER TABLE songs ADD COLUMN artist_name VARCHAR",
            "ALTER TABLE songs ADD COLUMN mb_recording_id VARCHAR",
        ]:
            try:
                await conn.execute(text(col_sql))
            except Exception:
                pass  # column already exists


# ── Queries ────────────────────────────────────────────────────────────────────

def _with_relations(stmt):
    return stmt.options(
        selectinload(Song.genres),
        selectinload(Song.labels),
        selectinload(Song.members).selectinload(Member.instruments),
    )


async def get_song_by_mb_id(mb_recording_id: str) -> Song | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            _with_relations(select(Song).where(Song.mb_recording_id == mb_recording_id))
        )
        return result.scalar_one_or_none()


async def get_song(artist: str, song: str) -> Song | None:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            _with_relations(
                select(Song).where(Song.artist == artist, Song.song == song)
            )
        )
        return result.scalar_one_or_none()


async def list_songs(limit: int = 20) -> list[Song]:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            _with_relations(
                select(Song).order_by(Song.created_at.desc()).limit(limit)
            )
        )
        return list(result.scalars().all())


async def upsert_song(artist: str, song: str, **kwargs) -> Song:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Song).where(Song.artist == artist, Song.song == song)
        )
        existing = result.scalar_one_or_none()
        if existing:
            for key, value in kwargs.items():
                setattr(existing, key, value)
            await session.commit()
            return existing
        else:
            new_song = Song(artist=artist, song=song, **kwargs)
            session.add(new_song)
            await session.commit()
            await session.refresh(new_song)
            return new_song


async def upsert_song_by_mb_id(mb_recording_id: str, **kwargs) -> Song:
    async with AsyncSessionLocal() as session:
        result = await session.execute(
            select(Song).where(Song.mb_recording_id == mb_recording_id)
        )
        existing = result.scalar_one_or_none()
        if existing:
            for key, value in kwargs.items():
                setattr(existing, key, value)
            await session.commit()
            return existing
        else:
            new_song = Song(mb_recording_id=mb_recording_id, **kwargs)
            session.add(new_song)
            await session.commit()
            await session.refresh(new_song)
            return new_song


async def upsert_song_relations(
    artist: str,
    song: str,
    genres: list[str],
    labels: list[str],
    members: list[dict],  # [{"name": str, "instruments": [str]}]
    mb_recording_id: str | None = None,
) -> None:
    """Upsert genres, labels, members (with instruments) and link them to the song."""
    async with AsyncSessionLocal() as session:
        if mb_recording_id:
            song_row = (await session.execute(
                select(Song).where(Song.mb_recording_id == mb_recording_id)
            )).scalar_one_or_none()
        else:
            song_row = (await session.execute(
                select(Song).where(Song.artist == artist, Song.song == song)
            )).scalar_one_or_none()
        if not song_row:
            return

        async def get_or_create(model, name: str) -> int:
            row = (await session.execute(
                select(model).where(model.name == name)
            )).scalar_one_or_none()
            if not row:
                row = model(name=name)
                session.add(row)
                await session.flush()
            return row.id

        # Genres
        for g in genres:
            gid = await get_or_create(Genre, g)
            await session.execute(
                insert(song_genres_table)
                .prefix_with("OR IGNORE")
                .values(song_id=song_row.id, genre_id=gid)
            )

        # Labels
        for lb in labels:
            lid = await get_or_create(Label, lb)
            await session.execute(
                insert(song_labels_table)
                .prefix_with("OR IGNORE")
                .values(song_id=song_row.id, label_id=lid)
            )

        # Members + their instruments
        for m in members:
            mid = await get_or_create(Member, m["name"])
            for instr in m.get("instruments", []):
                iid = await get_or_create(Instrument, instr)
                await session.execute(
                    insert(member_instruments_table)
                    .prefix_with("OR IGNORE")
                    .values(member_id=mid, instrument_id=iid)
                )
            await session.execute(
                insert(song_members_table)
                .prefix_with("OR IGNORE")
                .values(song_id=song_row.id, member_id=mid)
            )

        await session.commit()


# ── Serialization ──────────────────────────────────────────────────────────────

def _safe(obj, attr: str) -> list:
    try:
        return getattr(obj, attr) or []
    except Exception:
        return []


def song_to_dict(s: Song) -> dict:
    return {
        "id":               s.id,
        "artist":           s.artist,
        "song":             s.song,
        "artist_name":      s.artist_name,
        "youtube_url":      s.youtube_url,
        "title":            s.title,
        "year":             s.year,
        "album":            s.album,
        "bpm":              s.bpm,
        "audio_path":       s.audio_path,
        "stems_dir":        s.stems_dir,
        "analysis":         json.loads(s.analysis_json) if s.analysis_json else None,
        "created_at":       s.created_at.isoformat() if s.created_at else None,
        "mb_recording_id":  s.mb_recording_id,
        "genres":  [g.name for g in _safe(s, "genres")],
        "labels":  [lb.name for lb in _safe(s, "labels")],
        "members": [
            {"name": m.name, "instruments": [i.name for i in _safe(m, "instruments")]}
            for m in _safe(s, "members")
        ],
    }
