"""Motores de generación de audio del sidecar.

`MusicGenEngine` usa MusicGen (Meta) a través de Hugging Face `transformers`.
Torch y transformers se importan de forma perezosa: el servidor arranca (y los tests
corren) sin tenerlos instalados.
"""

from __future__ import annotations

import math
import os
from collections.abc import Callable
from dataclasses import dataclass
from typing import Protocol

import numpy as np

# Modelos soportados, de menor a mayor. En CPU solo es práctico el "small".
MODELS: dict[str, dict[str, object]] = {
    "facebook/musicgen-small": {"label": "MusicGen small (300M) · mono", "ram_gb": 3},
    "facebook/musicgen-stereo-small": {"label": "MusicGen small (300M) · estéreo", "ram_gb": 3},
    "facebook/musicgen-medium": {"label": "MusicGen medium (1.5B) · mono", "ram_gb": 8},
    "facebook/musicgen-stereo-medium": {"label": "MusicGen medium (1.5B) · estéreo", "ram_gb": 8},
    "facebook/musicgen-large": {"label": "MusicGen large (3.3B) · mono", "ram_gb": 16},
}
DEFAULT_MODEL = "facebook/musicgen-small"
MAX_SECONDS = 30  # MusicGen está entrenado con fragmentos de 30 s


class Cancelled(Exception):
    """El usuario canceló la generación."""


@dataclass
class Audio:
    samples: np.ndarray  # float32, forma (canales, muestras), en [-1, 1]
    sample_rate: int


# on_progress(fracción 0..1, etapa) -> None; debe lanzar Cancelled para detener.
ProgressFn = Callable[[float | None, str], None]


class Engine(Protocol):
    def device_info(self) -> dict[str, object]: ...

    def generate(
        self,
        prompt: str,
        seconds: float,
        seed: int | None,
        model: str,
        on_progress: ProgressFn,
        prompt_audio: Audio | None = None,
        keep_lead_sec: float = 0,
    ) -> Audio: ...


def _resample(wave: np.ndarray, src_rate: int, dst_rate: int) -> np.ndarray:
    """Remuestrea un canal (interpolación lineal; suficiente para condicionar)."""
    if src_rate == dst_rate:
        return wave.astype(np.float32)
    n = round(len(wave) * dst_rate / src_rate)
    x = np.linspace(0, len(wave) - 1, n)
    return np.interp(x, np.arange(len(wave)), wave).astype(np.float32)


def kept_samples(keep_lead_sec: float, prompt_audio: Audio | None, sample_rate: int) -> int:
    """Muestras de la partida que se devuelven delante del audio nuevo (nunca más que ella)."""
    if prompt_audio is None or keep_lead_sec <= 0:
        return 0
    lead_sec = prompt_audio.samples.shape[-1] / prompt_audio.sample_rate
    return round(min(keep_lead_sec, lead_sec) * sample_rate)


def prompt_wave(audio: Audio, sample_rate: int, channels: int) -> np.ndarray:
    """
    Audio de partida en la forma que espera el modelo: un vector (muestras,) para los
    mono y una matriz (2, muestras) para los estéreo. Un vector plano en un modelo
    estéreo se lee como "N canales" y falla; el mono se duplica a los dos canales.
    """
    samples = audio.samples if audio.samples.ndim == 2 else audio.samples[np.newaxis, :]
    if channels == 1:
        return _resample(samples.mean(axis=0), audio.sample_rate, sample_rate)
    left, right = (samples[0], samples[1]) if len(samples) >= 2 else (samples[0], samples[0])
    return np.stack(
        [
            _resample(left, audio.sample_rate, sample_rate),
            _resample(right, audio.sample_rate, sample_rate),
        ]
    )


def detect_device() -> dict[str, object]:
    """Elige GPU CUDA si hay una compatible con la versión de torch instalada; si no, CPU."""
    try:
        import torch
    except ImportError:
        return {"device": "cpu", "gpu": None, "reason": "torch no instalado"}
    if torch.cuda.is_available():
        major, minor = torch.cuda.get_device_capability(0)
        name = torch.cuda.get_device_name(0)
        supported = f"sm_{major}{minor}" in torch.cuda.get_arch_list()
        if supported:
            return {"device": "cuda", "gpu": name}
        return {
            "device": "cpu",
            "gpu": name,
            "reason": f"GPU demasiado antigua (sm_{major}{minor})",
        }
    return {"device": "cpu", "gpu": None, "reason": "sin GPU CUDA"}


class MusicGenEngine:
    def __init__(self) -> None:
        self._model_id: str | None = None
        self._model = None
        self._processor = None
        self._device = detect_device()

    def device_info(self) -> dict[str, object]:
        return {**self._device, "loaded_model": self._model_id, "threads": os.cpu_count()}

    def _load(self, model_id: str, on_progress: ProgressFn) -> None:
        if self._model_id == model_id:
            return
        import torch
        from transformers import AutoProcessor, MusicgenForConditionalGeneration

        on_progress(
            None, "Cargando el modelo (la primera vez se descarga, puede tardar varios minutos)…"
        )
        self._model = self._processor = None  # liberar el anterior antes de cargar otro
        self._processor = AutoProcessor.from_pretrained(model_id)
        model = MusicgenForConditionalGeneration.from_pretrained(model_id)
        if self._device["device"] == "cuda":
            model = model.to("cuda", dtype=torch.float16)
        else:
            # transformers 5 carga el checkpoint en su tipo original (float16 en los
            # estéreo); en CPU el audio de partida va en float32 y no casarían.
            model = model.float()
            torch.set_num_threads(os.cpu_count() or 4)
        self._model = model.eval()
        self._model_id = model_id

    def generate(
        self,
        prompt: str,
        seconds: float,
        seed: int | None,
        model: str,
        on_progress: ProgressFn,
        prompt_audio: Audio | None = None,
        keep_lead_sec: float = 0,
    ) -> Audio:
        """
        Genera `seconds` de audio nuevo. Con `prompt_audio`, continúa ese audio y, con
        `keep_lead_sec`, devuelve delante los últimos segundos de la partida tal como
        los decodifica el modelo: la app los usa para un fundido cruzado sin costura.
        """
        import torch
        from transformers import LogitsProcessor, LogitsProcessorList

        if model not in MODELS:
            raise ValueError(f"Modelo no soportado: {model}")
        self._load(model, on_progress)
        assert self._model is not None and self._processor is not None

        frame_rate = int(self._model.config.audio_encoder.frame_rate)
        # Unos pasos de más: MusicGen trabaja en bloques de 1/50 s y el recorte a compases
        # se hace después (mejor que sobre a que falte).
        steps = max(1, math.ceil(seconds * frame_rate) + 4)

        class Progress(LogitsProcessor):
            """Se llama una vez por paso de generación: informa y permite cancelar."""

            def __init__(self) -> None:
                self.step = 0

            def __call__(self, input_ids, scores):
                self.step += 1
                if self.step % 5 == 0:
                    on_progress(min(1.0, self.step / steps), "Generando…")
                return scores

        sr = int(self._model.config.audio_encoder.sampling_rate)
        if seed is not None:
            torch.manual_seed(seed)
        lead = 0
        if prompt_audio is not None:
            # MusicGen stereo espera 2 canales; los demás, uno.
            channels = int(getattr(self._processor.feature_extractor, "feature_size", 1))
            wave_in = prompt_wave(prompt_audio, sr, channels)
            lead = wave_in.shape[-1]
            inputs = self._processor(
                audio=wave_in, sampling_rate=sr, text=[prompt], padding=True, return_tensors="pt"
            )
        else:
            inputs = self._processor(text=[prompt], padding=True, return_tensors="pt")
        inputs = inputs.to(self._model.device)
        on_progress(0.0, "Generando…")
        with torch.inference_mode():
            out = self._model.generate(
                **inputs,
                max_new_tokens=steps,
                do_sample=True,
                guidance_scale=3.0,
                logits_processor=LogitsProcessorList([Progress()]),
            )
        samples = out[0].float().cpu().numpy()  # (canales, muestras)
        # MusicGen devuelve el audio de partida seguido de la continuación: lo nuevo y,
        # si se pide, un poco de la partida para fundir.
        keep = min(lead, kept_samples(keep_lead_sec, prompt_audio, sr))
        samples = samples[:, lead - keep :]
        return Audio(samples=np.clip(samples, -1, 1).astype(np.float32), sample_rate=sr)


class FakeEngine:
    """Motor falso para tests: un tono, con progreso y cancelación reales."""

    def __init__(self, delay: float = 0.0) -> None:
        self.delay = delay

    def device_info(self) -> dict[str, object]:
        return {"device": "cpu", "gpu": None, "loaded_model": "fake", "threads": 1}

    def generate(
        self,
        prompt: str,
        seconds: float,
        seed: int | None,
        model: str,
        on_progress: ProgressFn,
        prompt_audio: Audio | None = None,
        keep_lead_sec: float = 0,
    ) -> Audio:
        import time

        self.last_prompt_audio = prompt_audio

        for i in range(10):
            on_progress(i / 10, "Generando…")
            time.sleep(self.delay / 10)
        sr = 32000
        keep = kept_samples(keep_lead_sec, prompt_audio, sr)
        t = np.arange(int(seconds * sr) + keep) / sr
        tone = (0.3 * np.sin(2 * np.pi * 220 * t)).astype(np.float32)
        return Audio(samples=tone[np.newaxis, :], sample_rate=sr)
