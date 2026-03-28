from collections.abc import Callable
from dataclasses import asdict, dataclass
from pathlib import Path

import librosa
import numpy as np


@dataclass
class GuitarAnalysis:
    # ── Signal info ──────────────────────────────────────────────────────────
    duration: float            # secondes
    sample_rate: int           # Hz
    # ── Tonalité ─────────────────────────────────────────────────────────────
    key: str                   # ex. "A major"
    chroma: list[float]        # 12 classes chromatiques (moyennées)
    # ── Rythme ───────────────────────────────────────────────────────────────
    tempo: float               # BPM estimé
    onset_rate: float          # attaques par seconde
    # ── Timbre / EQ ──────────────────────────────────────────────────────────
    spectral_centroid: float   # Hz — brillance
    spectral_bandwidth: float  # Hz — largeur de bande
    spectral_rolloff: float    # Hz — présence hautes fréquences
    spectral_flatness: float   # 0=tonal, 1=bruit
    spectral_contrast: list[float]  # 7 bandes
    mfcc: list[float]          # 13 coefficients — empreinte tonale
    # ── Dynamique ────────────────────────────────────────────────────────────
    rms_energy: float          # énergie RMS moyenne
    rms_db: float              # énergie RMS en dB
    peak_amplitude: float      # amplitude crête
    crest_factor: float        # facteur de crête
    dynamic_range_db: float    # plage dynamique (dB) entre segments forts et faibles
    zero_crossing_rate: float  # taux de passages par zéro (agressivité)
    # ── Harmonicité / Distorsion ─────────────────────────────────────────────
    hnr: float                 # rapport harmonique/bruit (dB) — distorsion
    # ── Effets ───────────────────────────────────────────────────────────────
    rt60: float                # secondes — quantité de reverb estimée
    delay_time: float          # secondes — écho/delay détecté


_PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]

_MAJOR_PROFILE = np.array([6.35, 2.23, 3.48, 2.33, 4.38, 4.09, 2.52, 5.19, 2.39, 3.66, 2.29, 2.88])
_MINOR_PROFILE = np.array([6.33, 2.68, 3.52, 5.38, 2.60, 3.53, 2.54, 4.75, 3.98, 2.69, 3.34, 3.17])


def _estimate_key(chroma_mean: np.ndarray) -> str:
    best_score, best_key = -np.inf, "C major"
    for root in range(12):
        rotated = np.roll(chroma_mean, -root)
        major_score = float(np.corrcoef(rotated, _MAJOR_PROFILE)[0, 1])
        minor_score = float(np.corrcoef(rotated, _MINOR_PROFILE)[0, 1])
        if major_score > best_score:
            best_score, best_key = major_score, f"{_PITCH_CLASSES[root]} major"
        if minor_score > best_score:
            best_score, best_key = minor_score, f"{_PITCH_CLASSES[root]} minor"
    return best_key


def _estimate_rt60(y: np.ndarray, sr: int) -> float:
    try:
        energy = y ** 2
        cumulative = np.cumsum(energy[::-1])[::-1]
        cumulative = cumulative / (cumulative[0] + 1e-10)
        below_60db = np.where(cumulative < 10 ** (-60 / 10))[0]
        if len(below_60db) == 0:
            return float(len(y) / sr)
        return float(below_60db[0] / sr)
    except Exception:
        return 0.0


def _estimate_delay(y: np.ndarray, sr: int) -> float:
    try:
        clip = y[:sr * 10]
        corr = np.correlate(clip, clip, mode="full")
        corr = corr[len(corr) // 2:]
        min_lag = int(sr * 0.05)
        max_lag = int(sr * 2)
        peak = np.argmax(corr[min_lag:max_lag]) + min_lag
        return float(peak / sr)
    except Exception:
        return 0.0


def _dynamic_range_db(y: np.ndarray, sr: int, frame_sec: float = 0.5) -> float:
    try:
        frame_len = int(sr * frame_sec)
        frames = [y[i:i + frame_len] for i in range(0, len(y) - frame_len, frame_len)]
        rms_frames = np.array([np.sqrt(np.mean(f ** 2) + 1e-10) for f in frames])
        top = np.percentile(rms_frames, 95)
        bot = np.percentile(rms_frames, 5)
        return float(20 * np.log10(top / (bot + 1e-10)))
    except Exception:
        return 0.0


def analyze_guitar(
    guitar_path: Path,
    on_log: Callable[[str], None] | None = None,
) -> GuitarAnalysis:
    def log(msg: str) -> None:
        if on_log:
            on_log(msg)

    log(f"Chargement du fichier : {guitar_path.name}")
    y, sr = librosa.load(str(guitar_path), sr=None, mono=True)
    duration = float(len(y) / sr)
    log(f"Durée : {duration:.1f}s  —  Sample rate : {sr} Hz  —  {len(y):,} échantillons")

    log("Calcul des features chromatiques (tonalité)...")
    chroma = librosa.feature.chroma_cqt(y=y, sr=sr)
    chroma_mean = np.mean(chroma, axis=1)
    key = _estimate_key(chroma_mean)
    log(f"→ Tonalité estimée : {key}")

    log("Détection du tempo et des onsets...")
    tempo_arr, _ = librosa.beat.beat_track(y=y, sr=sr)
    tempo = float(np.mean(tempo_arr))
    onset_frames = librosa.onset.onset_detect(y=y, sr=sr)
    onset_rate = float(len(onset_frames) / duration)
    log(f"→ Tempo : {tempo:.1f} BPM  —  Onsets : {len(onset_frames)} ({onset_rate:.2f}/s)")

    log("Analyse spectrale (centroïde, largeur, rolloff, flatness)...")
    centroid   = float(np.mean(librosa.feature.spectral_centroid(y=y, sr=sr)))
    bandwidth  = float(np.mean(librosa.feature.spectral_bandwidth(y=y, sr=sr)))
    rolloff    = float(np.mean(librosa.feature.spectral_rolloff(y=y, sr=sr, roll_percent=0.85)))
    flatness   = float(np.mean(librosa.feature.spectral_flatness(y=y)))
    log(f"→ Centroïde : {centroid:.0f} Hz  —  Bandwidth : {bandwidth:.0f} Hz")
    log(f"→ Rolloff : {rolloff:.0f} Hz  —  Flatness : {flatness:.4f}")

    log("Calcul du contraste spectral (7 bandes)...")
    contrast = [float(v) for v in np.mean(librosa.feature.spectral_contrast(y=y, sr=sr), axis=1)]
    log(f"→ Contraste : {[round(v, 2) for v in contrast]}")

    log("Extraction des MFCC (13 coefficients)...")
    mfcc = [float(v) for v in np.mean(librosa.feature.mfcc(y=y, sr=sr, n_mfcc=13), axis=1)]
    log(f"→ MFCC[0..4] : {[round(v, 2) for v in mfcc[:5]]}")

    log("Calcul de la dynamique (RMS, crête, plage dynamique, ZCR)...")
    rms = float(np.mean(librosa.feature.rms(y=y)))
    rms_db = float(20 * np.log10(rms + 1e-10))
    peak = float(np.max(np.abs(y)))
    crest_factor = float(peak / (rms + 1e-10))
    dyn_range = _dynamic_range_db(y, sr)
    zcr = float(np.mean(librosa.feature.zero_crossing_rate(y=y)))
    log(f"→ RMS : {rms:.6f} ({rms_db:.1f} dB)  —  Crête : {peak:.4f}  —  Crest factor : {crest_factor:.2f}")
    log(f"→ Plage dynamique : {dyn_range:.1f} dB  —  ZCR : {zcr:.4f}")

    log("Séparation harmonique/percussive (HNR / distorsion)...")
    harmonic, _ = librosa.effects.hpss(y)
    harmonic_energy = float(np.mean(harmonic ** 2))
    noise_energy = float(np.mean((y - harmonic) ** 2))
    hnr = float(10 * np.log10((harmonic_energy + 1e-10) / (noise_energy + 1e-10)))
    log(f"→ HNR : {hnr:.2f} dB  ({'signal propre' if hnr > 5 else 'distorsion/bruit élevé'})")

    log("Estimation du RT60 (reverb)...")
    rt60 = _estimate_rt60(y, sr)
    log(f"→ RT60 estimé : {rt60:.3f}s")

    log("Détection du delay/écho (autocorrélation sur 10s)...")
    delay_time = _estimate_delay(y, sr)
    log(f"→ Delay détecté : {delay_time:.3f}s")

    log("Analyse terminée.")

    return GuitarAnalysis(
        duration=round(duration, 2),
        sample_rate=sr,
        key=key,
        chroma=[round(float(v), 4) for v in chroma_mean],
        tempo=round(tempo, 2),
        onset_rate=round(onset_rate, 4),
        spectral_centroid=round(centroid, 2),
        spectral_bandwidth=round(bandwidth, 2),
        spectral_rolloff=round(rolloff, 2),
        spectral_flatness=round(flatness, 6),
        spectral_contrast=[round(v, 4) for v in contrast],
        mfcc=[round(v, 4) for v in mfcc],
        rms_energy=round(rms, 6),
        rms_db=round(rms_db, 2),
        peak_amplitude=round(peak, 6),
        crest_factor=round(crest_factor, 4),
        dynamic_range_db=round(dyn_range, 2),
        zero_crossing_rate=round(zcr, 6),
        hnr=round(hnr, 4),
        rt60=round(rt60, 4),
        delay_time=round(delay_time, 4),
    )


def analysis_to_dict(analysis: GuitarAnalysis) -> dict:
    return asdict(analysis)
