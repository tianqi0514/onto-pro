from fastapi.testclient import TestClient

from backend.app.main import app


client = TestClient(app)


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_projects():
    response = client.get("/api/projects")
    assert response.status_code == 200
    assert len(response.json()) >= 1


def test_agent_run():
    response = client.post(
        "/api/agent/runs",
        json={"project_id": "project_qsl_001", "task_id": "scenario.leasing_risk_review"},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["matched_scenario"]["id"] == "scenario.leasing_risk_review"
    assert payload["conclusion"]["risk_level"] == "manual_review"


def test_eval_run():
    response = client.post("/api/eval/runs", json={"suite_id": "evalsuite.leasing.p0"})
    assert response.status_code == 200
    assert response.json()["total"] >= 1
