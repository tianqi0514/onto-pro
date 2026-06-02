from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data" / "workspaces" / "default"


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


def find_by_id(items: List[Dict[str, Any]], item_id: str, key: str = "id") -> Dict[str, Any]:
    for item in items:
        if item.get(key) == item_id:
            return item
    raise HTTPException(status_code=404, detail=f"Item not found: {item_id}")


@app.get("/api/health")
def health() -> Dict[str, str]:
    return {"status": "ok", "storage": "local_files", "version": "0.1.0"}


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

    return {
        "run_id": f"run_{payload.project_id}_{payload.task_id}",
        "project_id": payload.project_id,
        "project_name": project["name"],
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
                "issue": "OCR、对象存储、外部实时查询仍为开发中。",
                "impact": "当前结论只用于离线样例验证。",
                "required_action": "客户试用前接入真实接口或确认人工标注结果。",
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
