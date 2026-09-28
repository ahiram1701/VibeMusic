import io
import time
import wave

from fastapi.testclient import TestClient

from engine import FakeEngine
from server import create_app


def wait_for(client: TestClient, job_id: str, status: str, timeout: float = 5.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        body = client.get(f"/jobs/{job_id}").json()
        if body["status"] == status:
            return body
        time.sleep(0.02)
    raise AssertionError(f"el trabajo no llegó a {status}: {body}")


def test_health_lists_device_and_models() -> None:
    body = TestClient(create_app(FakeEngine())).get("/health").json()
    assert body["status"] == "ok"
    assert body["device"]["device"] == "cpu"
    assert any(m["id"] == "facebook/musicgen-small" for m in body["models"])
    assert body["max_seconds"] == 30


def test_generates_a_wav_with_progress() -> None:
    client = TestClient(create_app(FakeEngine(delay=0.1)))
    job = client.post("/jobs", json={"prompt": "lofi drums", "seconds": 2, "seed": 1}).json()
    assert job["status"] in ("queued", "running")
    wait_for(client, job["id"], "done")

    res = client.get(f"/jobs/{job['id']}/audio")
    assert res.headers["content-type"] == "audio/wav"
    with wave.open(io.BytesIO(res.content)) as w:
        assert w.getframerate() == 32000
        assert w.getnframes() == 64000
    # El audio se entrega una sola vez.
    assert client.get(f"/jobs/{job['id']}/audio").status_code == 404


def test_cancel_running_job() -> None:
    client = TestClient(create_app(FakeEngine(delay=2)))
    job = client.post("/jobs", json={"prompt": "x", "seconds": 1}).json()
    wait_for(client, job["id"], "running")
    client.delete(f"/jobs/{job['id']}")
    assert wait_for(client, job["id"], "cancelled")["stage"] == "Cancelado"


def test_validates_input() -> None:
    client = TestClient(create_app(FakeEngine()))
    assert client.post("/jobs", json={"prompt": "x", "seconds": 45}).status_code == 422
    assert client.post("/jobs", json={"prompt": "", "seconds": 5}).status_code == 422
    assert (
        client.post("/jobs", json={"prompt": "x", "seconds": 5, "model": "otro/modelo"}).status_code
        == 400
    )
    assert client.get("/jobs/nope").status_code == 404
