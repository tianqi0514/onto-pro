from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data" / "workspaces" / "default"
RUNTIME_DIR = ROOT_DIR / "data" / "runtime"
LLM_SETTINGS_PATH = RUNTIME_DIR / "llm_settings.json"
FEEDBACK_PATH = RUNTIME_DIR / "feedback.json"


class AgentRunRequest(BaseModel):
    project_id: str
    task_id: str
    question: Optional[str] = None


class EvalRunRequest(BaseModel):
    suite_id: str


class SimulationRunRequest(BaseModel):
    project_id: str
    template_id: str
    assumptions: List[Dict[str, Any]] = []


class LlmSettingsRequest(BaseModel):
    provider: str = "openai"
    model: str = "gpt-4.1-mini"
    base_url: str = "https://api.openai.com/v1"
    api_key: Optional[str] = None
    temperature: float = 0.2
    enabled: bool = False


class RuleTestRequest(BaseModel):
    project_id: str
    rule_id: str


class FeedbackRequest(BaseModel):
    run_id: str
    project_id: str
    rating: str
    comment: Optional[str] = None
    save_as_eval_case: bool = False


app = FastAPI(
    title="Onto Pro API",
    version="0.1.0",
    description="Local-file first MVP API for ontology-driven financial workflows.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def read_json(relative_path: str) -> Any:
    path = DATA_DIR / relative_path
    if not path.exists():
        raise HTTPException(status_code=404, detail=f"Mock data not found: {relative_path}")
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def read_runtime_json(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_runtime_json(path: Path, payload: Any) -> None:
    RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as file:
        json.dump(payload, file, ensure_ascii=False, indent=2)


def find_by_id(items: List[Dict[str, Any]], item_id: str, key: str = "id") -> Dict[str, Any]:
    for item in items:
        if item.get(key) == item_id:
            return item
    raise HTTPException(status_code=404, detail=f"Item not found: {item_id}")


def default_llm_settings() -> Dict[str, Any]:
    return {
        "provider": "openai",
        "model": "gpt-4.1-mini",
        "base_url": "https://api.openai.com/v1",
        "api_key": "",
        "temperature": 0.2,
        "enabled": False,
    }


def mask_secret(value: Optional[str]) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "********"
    return f"{value[:4]}...{value[-4:]}"


def get_llm_settings_internal() -> Dict[str, Any]:
    settings = default_llm_settings()
    settings.update(read_runtime_json(LLM_SETTINGS_PATH, {}))
    return settings


def public_llm_settings(settings: Dict[str, Any]) -> Dict[str, Any]:
    api_key = settings.get("api_key", "")
    return {
        "provider": settings.get("provider", "openai"),
        "model": settings.get("model", "gpt-4.1-mini"),
        "base_url": settings.get("base_url", "https://api.openai.com/v1"),
        "temperature": settings.get("temperature", 0.2),
        "enabled": bool(settings.get("enabled")),
        "configured": bool(api_key),
        "api_key_masked": mask_secret(api_key),
    }


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "storage": "local_files", "version": "0.1.0"}


@app.get("/api/settings/llm")
def get_llm_settings() -> Dict[str, Any]:
    return public_llm_settings(get_llm_settings_internal())


@app.put("/api/settings/llm")
def save_llm_settings(payload: LlmSettingsRequest) -> Dict[str, Any]:
    current = get_llm_settings_internal()
    next_settings = {
        "provider": payload.provider.strip() or current["provider"],
        "model": payload.model.strip() or current["model"],
        "base_url": payload.base_url.strip() or current["base_url"],
        "api_key": current.get("api_key", ""),
        "temperature": payload.temperature,
        "enabled": payload.enabled,
    }
    if payload.api_key is not None and payload.api_key.strip():
        next_settings["api_key"] = payload.api_key.strip()
    write_runtime_json(LLM_SETTINGS_PATH, next_settings)
    return public_llm_settings(next_settings)


@app.post("/api/settings/llm/test")
def test_llm_settings() -> Dict[str, Any]:
    settings = get_llm_settings_internal()
    configured = bool(settings.get("api_key"))
    return {
        "status": "ready" if configured else "missing_key",
        "provider": settings.get("provider"),
        "model": settings.get("model"),
        "base_url": settings.get("base_url"),
        "message": "LLM Key 已配置，当前处于本地样例测试模式。" if configured else "请先配置 LLM API Key。",
    }


@app.get("/api/projects")
def list_projects() -> List[Dict[str, Any]]:
    return read_json("projects.json")


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> Dict[str, Any]:
    return find_by_id(read_json("projects.json"), project_id)


@app.get("/api/projects/{project_id}/documents")
def list_project_documents(project_id: str) -> List[Dict[str, Any]]:
    documents = read_json("documents.json")
    return [document for document in documents if document["project_id"] == project_id]


@app.get("/api/documents/{document_id}/extraction")
def get_document_extraction(document_id: str) -> Dict[str, Any]:
    extractions = read_json("extractions.json")
    return find_by_id(extractions, document_id, "document_id")


@app.post("/api/documents/{document_id}/parse")
def parse_document(document_id: str) -> Dict[str, Any]:
    extraction = get_document_extraction(document_id)
    return {
        "document_id": document_id,
        "status": "completed",
        "parser": "manual_annotation_mock",
        "message": "OCR 自动识别开发中，当前使用人工标注结构模拟。",
        "extraction": extraction,
    }


@app.get("/api/ontology/object-types")
def list_object_types() -> List[Dict[str, Any]]:
    return read_json("ontology/object_types.json")


@app.get("/api/ontology/relation-types")
def list_relation_types() -> List[Dict[str, Any]]:
    return read_json("ontology/relation_types.json")


@app.get("/api/rules")
def list_rules() -> List[Dict[str, Any]]:
    return read_json("ontology/rules.json")


@app.get("/api/scenarios")
def list_scenarios() -> List[Dict[str, Any]]:
    return read_json("ontology/scenarios.json")


@app.post("/api/agent/runs")
def create_agent_run(payload: AgentRunRequest) -> Dict[str, Any]:
    project = get_project(payload.project_id)
    scenarios = read_json("ontology/scenarios.json")
    scenario = find_by_id(scenarios, payload.task_id)
    rules = [rule for rule in read_json("ontology/rules.json") if rule["scenario_id"] == scenario["id"]]
    documents = list_project_documents(payload.project_id)
    llm_settings = public_llm_settings(get_llm_settings_internal())

    return {
        "run_id": f"run_{payload.project_id}_{payload.task_id}",
        "project_id": payload.project_id,
        "project_name": project["name"],
        "llm": {
            "provider": llm_settings["provider"],
            "model": llm_settings["model"],
            "configured": llm_settings["configured"],
            "enabled": llm_settings["enabled"],
        },
        "matched_scenario": {
            "id": scenario["id"],
            "name": scenario["name"],
            "confidence": 0.91,
        },
        "facts_used": [
            {
                "fact": "项目材料、人工标注抽取结果与离线 mock 数据已加载。",
                "source_type": "document",
                "source_ref": f"{len(documents)} documents",
            }
        ],
        "skills_called": [
            {
                "name": "material_check",
                "status": "completed",
                "mode": "local_file_mock",
            },
            {
                "name": "external_query",
                "status": "development",
                "mode": "offline_sample",
            },
        ],
        "rules_applied": [
            {
                "rule_id": rule["id"],
                "rule_name": rule["name"],
                "result": rule.get("mock_result", "manual_review"),
            }
            for rule in rules
        ],
        "reasoning_trace": [
            {
                "step": 1,
                "type": "scenario_match",
                "description": "根据任务入口匹配场景并加载本体切片。",
            },
            {
                "step": 2,
                "type": "skill_call",
                "description": "读取本地材料、人工标注结构和离线样例。",
            },
            {
                "step": 3,
                "type": "rule_application",
                "description": "应用当前场景允许的原子规则。",
            },
        ],
        "evidence": [
            {
                "source": document["name"],
                "location": document.get("location", "本地样例"),
                "excerpt_or_value": document["type"],
            }
            for document in documents[:3]
        ],
        "uncertainty": [
            {
                "issue": "当前为本地样例运行。",
                "impact": "可验证本体、规则、证据和评测链路，暂不代表生产结论。",
                "required_action": "在设置中心配置 LLM Key 后，可切换到真实模型编排。",
            }
        ],
        "conclusion": {
            "summary": f"{scenario['name']} 已完成 mock 运行，建议进入人工复核。",
            "risk_level": "manual_review",
        },
        "recommended_actions": [
            {
                "action": "查看证据链并将错误反馈保存为 EvalCase。",
                "execution_mode": "human_approval_required",
            }
        ],
    }


@app.post("/api/rules/{rule_id}/test")
def test_rule(rule_id: str, payload: RuleTestRequest) -> Dict[str, Any]:
    rule = find_by_id(read_json("ontology/rules.json"), rule_id)
    project = get_project(payload.project_id)
    documents = list_project_documents(payload.project_id)
    return {
        "rule_id": rule["id"],
        "rule_name": rule["name"],
        "project_id": project["id"],
        "project_name": project["name"],
        "status": "completed",
        "result": rule.get("mock_result", "manual_review"),
        "facts": [
            {"name": "材料数量", "value": len(documents)},
            {"name": "项目阶段", "value": project["stage"]},
            {"name": "规则严重性", "value": rule["severity"]},
        ],
        "evidence": [document["name"] for document in documents[:3]],
    }


@app.post("/api/agent/runs/{run_id}/feedback")
def save_agent_feedback(run_id: str, payload: FeedbackRequest) -> Dict[str, Any]:
    feedback_items = read_runtime_json(FEEDBACK_PATH, [])
    item = {
        "id": f"feedback_{len(feedback_items) + 1}",
        "run_id": run_id,
        "project_id": payload.project_id,
        "rating": payload.rating,
        "comment": payload.comment or "",
        "save_as_eval_case": payload.save_as_eval_case,
    }
    feedback_items.append(item)
    write_runtime_json(FEEDBACK_PATH, feedback_items)
    return {
        "status": "saved",
        "feedback": item,
        "eval_case_created": payload.save_as_eval_case,
    }


@app.get("/api/eval/suites")
def list_eval_suites() -> List[Dict[str, Any]]:
    return read_json("eval/suites.json")


@app.post("/api/eval/runs")
def create_eval_run(payload: EvalRunRequest) -> Dict[str, Any]:
    suite = find_by_id(read_json("eval/suites.json"), payload.suite_id)
    cases = [case for case in read_json("eval/cases.json") if case["suite_id"] == payload.suite_id]
    passed = sum(1 for case in cases if case["mock_status"] == "passed")
    return {
        "eval_run_id": f"evalrun_{payload.suite_id}",
        "suite_id": payload.suite_id,
        "suite_name": suite["name"],
        "status": "completed",
        "total": len(cases),
        "passed": passed,
        "pass_rate": round(passed / len(cases), 2) if cases else 0,
        "boundary_summary": {
            "L0-L4": "稳定",
            "L5": "关键字段可检出冲突",
            "L6-L7": "仅做边界探索",
        },
        "cases": cases,
    }


@app.get("/api/simulations/templates")
def list_simulation_templates() -> List[Dict[str, Any]]:
    return read_json("simulations/templates.json")


@app.get("/api/projects/{project_id}/simulation-templates")
def list_project_simulation_templates(project_id: str) -> Dict[str, Any]:
    get_project(project_id)
    return {
        "status": "development",
        "message": "模拟推演为 P2 后续模块，当前返回 mock 模板。",
        "templates": read_json("simulations/templates.json"),
    }


@app.post("/api/simulations/runs")
def create_simulation_run(payload: SimulationRunRequest) -> Dict[str, Any]:
    project = get_project(payload.project_id)
    template = find_by_id(read_json("simulations/templates.json"), payload.template_id)
    return {
        "simulation_run_id": f"sim_{payload.project_id}_{payload.template_id}",
        "project_id": payload.project_id,
        "project_name": project["name"],
        "template_id": template["id"],
        "status": "development",
        "assumptions": payload.assumptions or template["default_assumptions"],
        "diff": template["mock_diff"],
        "rules_changed": template["mock_rules_changed"],
        "impact_paths": template["mock_impact_paths"],
        "conclusion": {
            "summary": "模拟推演模块已预留，当前结果来自离线样例。",
            "risk_level_after": "manual_review",
            "disclaimer": "simulation_only",
        },
    }
