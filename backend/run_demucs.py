"""
Wrapper pour lancer Demucs en patchant torchaudio.save en mémoire.
torchaudio >= 2.9 requiert torchcodec pour sauvegarder les fichiers audio,
mais torchcodec nécessite des bibliothèques CUDA qui ne sont pas toujours disponibles.
Ce wrapper remplace torchaudio.save par soundfile comme fallback.
"""
import sys
import numpy as np
import soundfile as sf
import torchaudio


def _save_with_soundfile(uri, src, sample_rate, channels_first=True, **kwargs):
    wav_np = src.numpy()
    if channels_first and wav_np.ndim == 2:
        wav_np = wav_np.T
    sf.write(str(uri), wav_np, sample_rate)


torchaudio.save = _save_with_soundfile

from demucs.__main__ import main  # noqa: E402

main()
