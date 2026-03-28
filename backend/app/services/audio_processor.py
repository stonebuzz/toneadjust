import os
import re
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path

_HERE = Path(__file__).resolve().parent.parent.parent  # backend/
DOWNLOAD_DIR = Path(os.getenv("DOWNLOAD_DIR", str(_HERE.parent / "downloads"))).resolve()


def _sanitize(name: str) -> str:
    return re.sub(r'[<>:"/\\|?*]', "_", name).strip()


def _stream(cmd: list[str], on_log: Callable[[str], None] | None) -> None:
    """Run a subprocess and stream its output line by line via on_log."""
    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,  # merge stderr into stdout
        text=True,
        bufsize=1,
    )
    if on_log and proc.stdout:
        for raw in proc.stdout:
            line = raw.rstrip()
            if line:
                on_log(line)
    proc.wait()
    if proc.returncode != 0:
        raise RuntimeError(
            f"Command {cmd[0]} exited with code {proc.returncode}"
        )


def separate_stems(
    audio_path: Path,
    mb_recording_id: str,
    on_log: Callable[[str], None] | None = None,
) -> dict[str, Path]:
    def log(msg: str) -> None:
        if on_log:
            on_log(msg)

    stems_dir  = DOWNLOAD_DIR / mb_recording_id / "stems"
    stems_dir.mkdir(parents=True, exist_ok=True)

    demucs_out = DOWNLOAD_DIR / mb_recording_id / "_demucs_tmp"
    demucs_out.mkdir(parents=True, exist_ok=True)

    run_demucs = Path(__file__).resolve().parent.parent.parent / "run_demucs.py"

    log(f"Démarrage de htdemucs_6s sur : {audio_path.name}")
    _stream(
        [
            sys.executable, str(run_demucs),
            "-n", "htdemucs_6s",
            "--out", str(demucs_out),
            str(audio_path),
        ],
        on_log,
    )

    audio_stem = audio_path.stem
    source_dir = demucs_out / "htdemucs_6s" / audio_stem

    # Move the 4 main stems — keep piano and other in source_dir for the merge step
    for stem in ["guitar", "bass", "vocals", "drums"]:
        src = source_dir / f"{stem}.wav"
        if src.exists():
            src.rename(stems_dir / f"{stem}.wav")
            log(f"Stem extrait : {stem}.wav")

    piano_src  = source_dir / "piano.wav"
    other_src  = source_dir / "other.wav"   # still in source_dir
    other_dest = stems_dir  / "other.wav"

    if piano_src.exists() and other_src.exists():
        log("Fusion piano + other via ffmpeg...")
        _stream(
            [
                "ffmpeg", "-y",
                "-i", str(piano_src),
                "-i", str(other_src),
                "-filter_complex", "amix=inputs=2:duration=longest",
                str(other_dest),
            ],
            on_log,
        )
        log("Stem extrait : other.wav (piano fusionné)")
    elif other_src.exists():
        other_src.rename(other_dest)
        log("Stem extrait : other.wav")
    elif piano_src.exists():
        piano_src.rename(other_dest)
        log("Stem extrait : piano → other.wav")

    shutil.rmtree(demucs_out, ignore_errors=True)
    log("Nettoyage du dossier temporaire.")

    return {
        "guitar": stems_dir / "guitar.wav",
        "bass":   stems_dir / "bass.wav",
        "vocals": stems_dir / "vocals.wav",
        "drums":  stems_dir / "drums.wav",
        "other":  other_dest,
    }
