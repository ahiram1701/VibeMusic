"""Separación de pistas (stems) con Demucs (Meta, licencia MIT).

Divide una canción en cuatro pistas: batería, bajo, voz y el resto ("other").
Demucs 4.1 no necesita torchaudio para separar: lee el audio con `sphn` y
remuestrea con `julius`. Todo se importa de forma perezosa.
"""

from __future__ import annotations

import importlib.util
import os
from dataclasses import dataclass
from typing import Protocol

import numpy as np

from engine import Audio, ProgressFn

MODEL = "htdemucs"
STEMS = ("drums", "bass", "other", "vocals")


@dataclass
class Stem:
    name: str  # drums | bass | other | vocals
    path: str
    rms: float  # nivel medio: ~0 significa que la pista está vacía


class Separator(Protocol):
    def available(self) -> bool: ...

    def separate(self, input_path: str, output_dir: str, on_progress: ProgressFn) -> list[Stem]: ...


def write_stems(
    sources: np.ndarray, names: tuple[str, ...], sample_rate: int, output_dir: str
) -> list[Stem]:
    """Guarda cada fuente (canales × muestras) como WAV de 16 bits."""
    from server import encode_wav  # evita import circular al cargar el módulo

    os.makedirs(output_dir, exist_ok=True)
    stems: list[Stem] = []
    for name, src in zip(names, sources, strict=True):
        path = os.path.join(output_dir, f"{name}.wav")
        with open(path, "wb") as f:
            f.write(encode_wav(Audio(samples=src.astype(np.float32), sample_rate=sample_rate)))
        stems.append(Stem(name=name, path=path, rms=float(np.sqrt(np.mean(src**2)))))
    return stems


class DemucsSeparator:
    def __init__(self) -> None:
        self._model = None

    def available(self) -> bool:
        return importlib.util.find_spec("demucs") is not None

    def _load(self, on_progress: ProgressFn):
        if self._model is None:
            from demucs.pretrained import get_model

            on_progress(None, "Cargando el separador (la primera vez se descarga, ~80 MB)…")
            self._model = get_model(MODEL).cpu().eval()
        return self._model

    def separate(self, input_path: str, output_dir: str, on_progress: ProgressFn) -> list[Stem]:
        import julius
        import sphn
        import torch
        import tqdm
        from demucs import apply

        if not os.path.isfile(input_path):
            raise FileNotFoundError(f"No existe el audio: {input_path}")
        model = self._load(on_progress)
        on_progress(0.0, "Leyendo el audio…")
        data, sr = sphn.read(input_path)  # (canales, muestras), float32
        wav = torch.from_numpy(np.asarray(data, dtype=np.float32))
        if wav.shape[0] == 1:
            wav = wav.repeat(2, 1)
        wav = wav[:2]
        if sr != model.samplerate:
            wav = julius.resample_frac(wav, sr, model.samplerate)

        # Demucs espera audio normalizado; se deshace al final.
        ref = wav.mean(0)
        mean, std = ref.mean(), ref.std() + 1e-8
        x = (wav - mean) / std

        class Progress(tqdm.tqdm):
            """Engancha la barra interna de Demucs para informar y permitir cancelar."""

            def update(self, n: float | None = 1) -> bool | None:
                result = super().update(n)
                on_progress(min(0.99, self.n / max(1, self.total or 1)), "Separando pistas…")
                return result

        original = apply.tqdm.tqdm
        apply.tqdm.tqdm = Progress
        try:
            on_progress(0.0, "Separando pistas…")
            with torch.inference_mode():
                out = apply.apply_model(
                    model, x[None], device="cpu", shifts=1, split=True, overlap=0.25, progress=True
                )[0]
        finally:
            apply.tqdm.tqdm = original
        out = out * std + mean
        return write_stems(out.numpy(), tuple(model.sources), model.samplerate, output_dir)


class FakeSeparator:
    """Separador falso para tests: reparte la entrada en cuatro pistas."""

    def __init__(self, installed: bool = True) -> None:
        self.installed = installed

    def available(self) -> bool:
        return self.installed

    def separate(self, input_path: str, output_dir: str, on_progress: ProgressFn) -> list[Stem]:
        from server import decode_wav

        with open(input_path, "rb") as f:
            audio = decode_wav(f.read())
        on_progress(0.5, "Separando pistas…")
        src = audio.samples
        sources = np.stack([src * 0.5, src * 0.3, src * 0.2, src * 0.0])
        return write_stems(sources, STEMS, audio.sample_rate, output_dir)
