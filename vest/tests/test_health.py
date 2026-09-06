from fastapi.testclient import TestClient

from thirdeye.main import app

client = TestClient(app)


def test_health_answers() -> None:
    response = client.get("/api/health")
    assert response.status_code == 200
    body = response.json()
    assert body["ok"] is True
    assert body["protocol"] == 1
