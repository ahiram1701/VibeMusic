"""Sidecar local de VibeMusic: genera audio en este equipo (CPU o GPU).

La app Electron lo lanza como proceso hijo y habla con él por HTTP en 127.0.0.1.
Las generaciones son trabajos en segundo plano, uno detrás de otro:
    POST   /jobs              crea un trabajo → {id}
    GET    /jobs/{id}         estado, progreso y etapa
    GET    /jobs/{id}/audio   WAV resultante
    DELETE /jobs/{id}         cancela
    GET    /health            estado del servidor, dispositivo y modelos
"""

from __future__ import annotations

import io
import os
import threading
import uuid
import wave
from dataclasses import dataclass, field
from queue import Queue

import numpy as np
from fastapi import FastAPI, HTTPException, Response
from pydantic import BaseModel, Field

from engine import DEFAULT_MODEL, MAX_SECONDS, MODELS, Audio, Cancelled, Engine

VERSION = "0.2.0"


def encode_wav(audio: Audio) -> bytes:
    """WAV PCM 16 bits (intercalado) a partir de muestras float32."""
    pcm = (np.clip(audio.samples, -1, 1) * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(pcm.shape[0])
        w.setsampwidth(2)
        w.setframerate(audio.sample_rate)
        w.writeframes(pcm.T.tobytes())
    return buf.getvalue()


@dataclass
class Job:
    id: str
    prompt: str
    seconds: float
    seed: int | None
    model: str
    status: str = "queued"  # queued | running | done | error | cancelled
    progress: float | None = None
    stage: str = "En cola"
    error: str | None = None
    wav: bytes | None = None
    cancel: threading.Event = field(default_factory=threading.Event)

    def public(self) -> dict[str, object]:
        return {
            "id": self.id,
            "status": self.status,
            "progress": self.progress,
            "stage": self.stage,
            "error": self.error,
        }


class JobRunner:
    """Ejecuta los trabajos de uno en uno en un hilo aparte (el modelo no es reentrante)."""

    def __init__(self, engine: Engine) -> None:
        self.engine = engine
        self.jobs: dict[str, Job] = {}
        self.queue: Queue[Job] = Queue()
        threading.Thread(target=self._worker, daemon=True).start()

    def submit(self, job: Job) -> None:
        self.jobs[job.id] = job
        self.queue.put(job)

    def _worker(self) -> None:
        while True:
            job = self.queue.get()
            if job.cancel.is_set():
                job.status, job.stage = "cancelled", "Cancelado"
                continue
            job.status, job.stage = "running", "Empezando…"

            def on_progress(progress: float | None, stage: str, job: Job = job) -> None:
                if job.cancel.is_set():
                    raise Cancelled()
                job.progress, job.stage = progress, stage

            try:
                audio = self.engine.generate(
                    job.prompt, job.seconds, job.seed, job.model, on_progress
                )
                job.wav = encode_wav(audio)
                job.status, job.progress, job.stage = "done", 1.0, "Listo"
            except Cancelled:
                job.status, job.stage = "cancelled", "Cancelado"
            except Exception as err:  # noqa: BLE001 — cualquier fallo se informa a la app
                job.status, job.stage, job.error = "error", "Error", f"{type(err).__name__}: {err}"


class JobRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=2000)
    seconds: float = Field(gt=0, le=MAX_SECONDS)
    seed: int | None = None
    model: str = DEFAULT_MODEL


def create_app(engine: Engine) -> FastAPI:
    app = FastAPI(title="VibeMusic sidecar", version=VERSION)
    runner = JobRunner(engine)

    @app.get("/health")
    def health() -> dict[str, object]:
        return {
            "status": "ok",
            "version": VERSION,
            "device": engine.device_info(),
            "models": [{"id": k, **v} for k, v in MODELS.items()],
            "max_seconds": MAX_SECONDS,
        }

    @app.post("/jobs")
    def create_job(req: JobRequest) -> dict[str, object]:
        if req.model not in MODELS:
            raise HTTPException(400, f"Modelo no soportado: {req.model}")
        job = Job(
            id=uuid.uuid4().hex[:12],
            prompt=req.prompt,
            seconds=req.seconds,
            seed=req.seed,
            model=req.model,
        )
        runner.submit(job)
        return job.public()

    def get(job_id: str) -> Job:
        job = runner.jobs.get(job_id)
        if not job:
            raise HTTPException(404, "Trabajo no encontrado")
        return job

    @app.get("/jobs/{job_id}")
    def job_status(job_id: str) -> dict[str, object]:
        return get(job_id).public()

    @app.get("/jobs/{job_id}/audio")
    def job_audio(job_id: str) -> Response:
        job = get(job_id)
        if job.status != "done" or job.wav is None:
            raise HTTPException(409, f"El trabajo no ha terminado ({job.status})")
        wav = job.wav
        job.wav = None  # se entrega una vez; libera memoria
        runner.jobs.pop(job_id, None)
        return Response(content=wav, media_type="audio/wav")

    @app.delete("/jobs/{job_id}")
    def cancel_job(job_id: str) -> dict[str, object]:
        job = get(job_id)
        job.cancel.set()
        return job.public()

    return app


if __name__ == "__main__":
    import uvicorn

    from engine import MusicGenEngine

    port = int(os.environ.get("VIBE_SIDECAR_PORT", "8765"))
    # Solo escucha en local: nadie de la red puede usarlo.
    uvicorn.run(create_app(MusicGenEngine()), host="127.0.0.1", port=port, log_level="warning")
