"""Sidecar local de VibeMusic.

La app Electron lo lanza como proceso hijo y habla con él por HTTP en localhost.
Los modelos reales (MusicGen, Stable Audio Open, Demucs) se cargan de forma perezosa
en la fase 5; por ahora expone el contrato y detección de GPU.
"""

from __future__ import annotations

import os

from fastapi import FastAPI

app = FastAPI(title="VibeMusic sidecar", version="0.1.0")


def detect_gpu() -> dict[str, object]:
    try:
        import torch  # type: ignore[import-not-found]
    except ImportError:
        return {"available": False, "reason": "torch no instalado"}
    if not torch.cuda.is_available():
        return {"available": False, "reason": "CUDA no disponible"}
    return {"available": True, "name": torch.cuda.get_device_name(0)}


@app.get("/health")
def health() -> dict[str, object]:
    return {"status": "ok", "gpu": detect_gpu(), "models": []}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="127.0.0.1", port=int(os.environ.get("VIBE_SIDECAR_PORT", "8765")))
