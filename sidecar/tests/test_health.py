from fastapi.testclient import TestClient

from server import app


def test_health_reports_ok_without_gpu_deps() -> None:
    res = TestClient(app).get("/health")
    assert res.status_code == 200
    body = res.json()
    assert body["status"] == "ok"
    assert "available" in body["gpu"]
