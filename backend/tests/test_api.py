from fastapi.testclient import TestClient
import pytest

from backend.app import db
from backend.app.main import app


client = TestClient(app)


@pytest.fixture(scope="session", autouse=True)
def seed_database():
    db.seed_base_data()
    yield
    db.execute("UPDATE llm_settings SET api_key='', enabled=false WHERE id=%s", ("default",))


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


def test_llm_settings_roundtrip():
    response = client.put(
        "/api/settings/llm",
        json={
            "provider": "openai",
            "model": "gpt-4.1-mini",
            "base_url": "https://api.openai.com/v1",
            "api_key": "sk-test-local",
            "temperature": 0.2,
            "enabled": False,
        },
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["configured"] is True
    assert "sk-test-local" not in str(payload)

    test_response = client.post("/api/settings/llm/test")
    assert test_response.status_code == 200
    assert test_response.json()["status"] == "configured"


def test_extraction_agent_config_roundtrip():
    current = client.get("/api/settings/extraction-agent")
    assert current.status_code == 200
    payload = current.json()
    payload["extraction_window"] = 3000
    payload["timeout_seconds"] = 20
    payload["allow_fallback"] = True
    payload["auto_parse_on_upload"] = False
    response = client.put("/api/settings/extraction-agent", json=payload)
    assert response.status_code == 200
    assert response.json()["extraction_window"] == 3000


def test_document_upload():
    response = client.post(
        "/api/projects/project_qsl_001/documents/upload",
        files={"file": ("测试材料.txt", b"\xe9\xa1\xb9\xe7\x9b\xae\xe5\x90\x88\xe5\x90\x8c\xe6\x9d\x90\xe6\x96\x99", "text/plain")},
    )
    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "uploaded"
    assert payload["document"]["name"] == "测试材料.txt"


def test_rule_test():
    response = client.post(
        "/api/rules/rule.collateral_coverage/test",
        json={"project_id": "project_qsl_001", "rule_id": "rule.collateral_coverage"},
    )
    assert response.status_code == 200
    assert response.json()["result"] == "hit"


def test_agent_feedback():
    response = client.post(
        "/api/agent/runs/run_project_qsl_001_scenario.leasing_risk_review/feedback",
        json={
            "run_id": "run_project_qsl_001_scenario.leasing_risk_review",
            "project_id": "project_qsl_001",
            "rating": "correct",
            "comment": "ok",
            "save_as_eval_case": True,
        },
    )
    assert response.status_code == 200
    assert response.json()["status"] == "saved"
