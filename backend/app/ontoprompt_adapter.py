from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Tuple


FINANCE_ENTITY_TYPES = [
    ("项目", "Project"),
    ("合同", "Contract"),
    ("承租人", "Subject"),
    ("出租人", "Subject"),
    ("保证人", "Subject"),
    ("抵押", "Collateral"),
    ("应收账款", "Receivable"),
    ("发票", "Invoice"),
    ("材料", "Document"),
    ("规则", "Rule"),
    ("放款", "Disbursement"),
]


def extract_ontology_from_text(text: str, document_name: str) -> Dict[str, Any]:
    """Finance-focused local ontology extraction.

    This adapter implements the nano-ontoprompt extraction contract in a compact
    local form: entities, relations, logic_rules, actions, confidence calibration
    and post-validation. It intentionally avoids copying unlicensed source.
    """
    entities = _extract_entities(text, document_name)
    relations = _infer_relations(entities, text, document_name)
    logic_rules = _extract_rules(text, document_name)
    result = {
        "entities": entities,
        "relations": relations,
        "logic_rules": logic_rules,
        "actions": _default_actions(logic_rules),
    }
    return validate_and_calibrate(result)


def parse_llm_json(raw: str) -> Dict[str, Any]:
    text = raw.strip()
    text = re.sub(r"^```(?:json)?\s*", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\s*```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start:end + 1])
        raise


def validate_and_calibrate(result: Dict[str, Any]) -> Dict[str, Any]:
    entities = _dedup(result.get("entities", []), ("name_cn", "type"))
    entity_names = {item.get("name_cn") for item in entities}

    relations = []
    issues = []
    for relation in _dedup(result.get("relations", []), ("source", "type", "target")):
        if relation.get("source") not in entity_names or relation.get("target") not in entity_names:
            relation["confidence"] = 0.35
            issues.append({
                "severity": "warning",
                "code": "BROKEN_RELATION_REF",
                "message": f"{relation.get('source')} -> {relation.get('target')} 未完全匹配实体",
            })
        else:
            relation["confidence"] = round(float(relation.get("confidence", 0.82)), 3)
        relations.append(relation)

    for entity in entities:
        base = float(entity.get("confidence", 0.82))
        if any(entity.get("name_cn") in (r.get("source"), r.get("target")) for r in relations):
            base += 0.05
        if not entity.get("description"):
            base -= 0.05
        entity["confidence"] = round(max(0.35, min(0.98, base)), 3)

    result["entities"] = entities
    result["relations"] = relations
    result["logic_rules"] = _dedup(result.get("logic_rules", []), ("name_cn",))
    result["validation_report"] = {
        "has_fatal": False,
        "has_errors": False,
        "total_issues": len(issues),
        "by_severity": {"warning": issues} if issues else {},
    }
    return result


def _extract_entities(text: str, document_name: str) -> List[Dict[str, Any]]:
    entities: List[Dict[str, Any]] = []
    lower_text = text.lower()
    doc_type = _document_type(document_name, text)
    entities.append(_entity(document_name, "Document", f"{doc_type}材料"))

    project_matches = re.findall(r"([\u4e00-\u9fa5A-Za-z0-9]+(?:建设|绿岸|港城|古城)[\u4e00-\u9fa5A-Za-z0-9]*项目)", text)
    for value in project_matches[:8]:
        entities.append(_entity(value, "Project", "从材料文本中识别的金融项目"))

    org_matches = re.findall(r"([\u4e00-\u9fa5A-Za-z0-9（）()]{2,32}(?:公司|集团|银行|中心|委员会))", text)
    for value in org_matches[:18]:
        entities.append(_entity(value, "Subject", "从材料文本中识别的业务主体"))

    if "抵押" in text:
        entities.append(_entity("抵押物", "Collateral", "用于风险缓释或担保的资产"))
    if "应收账款" in text or "保理" in text:
        entities.append(_entity("应收账款", "Receivable", "保理基础资产"))
    if "发票" in text:
        entities.append(_entity("发票", "Invoice", "贸易背景和付款凭证"))
    if "放款" in text:
        entities.append(_entity("放款条件", "Disbursement", "放款前置条件集合"))

    for keyword, entity_type in FINANCE_ENTITY_TYPES:
        if keyword in text or keyword.lower() in lower_text:
            entities.append(_entity(keyword, entity_type, f"金融业务概念：{keyword}"))
    return entities


def _infer_relations(entities: List[Dict[str, Any]], text: str, document_name: str) -> List[Dict[str, Any]]:
    relations: List[Dict[str, Any]] = []
    docs = [e for e in entities if e["type"] == "Document"]
    projects = [e for e in entities if e["type"] == "Project"]
    subjects = [e for e in entities if e["type"] == "Subject"]
    concepts = [e for e in entities if e["type"] not in {"Document", "Project", "Subject"}]

    for doc in docs:
        for project in projects[:2]:
            relations.append(_relation(project["name_cn"], doc["name_cn"], "HAS_DOCUMENT"))
    for project in projects[:2]:
        for subject in subjects[:6]:
            relations.append(_relation(project["name_cn"], subject["name_cn"], "HAS_PARTY"))
        for concept in concepts[:8]:
            relations.append(_relation(project["name_cn"], concept["name_cn"], "INVOLVES"))
    if not projects and docs:
        for concept in concepts[:8]:
            relations.append(_relation(docs[0]["name_cn"], concept["name_cn"], "MENTIONS"))
    return relations


def _extract_rules(text: str, document_name: str) -> List[Dict[str, Any]]:
    candidates: List[Tuple[str, str]] = [
        ("材料完整性检查", "材料" if "材料" in text else ""),
        ("合同金额一致性检查", "金额" if "金额" in text or "价款" in text else ""),
        ("抵押覆盖率检查", "抵押" if "抵押" in text else ""),
        ("放款前置条件检查", "放款" if "放款" in text else ""),
        ("贸易背景真实性检查", "保理" if "保理" in text or "发票" in text else ""),
    ]
    return [
        {
            "name_cn": name,
            "type": "validation",
            "formula": f"IF 文档包含 {trigger} THEN 触发 {name}",
            "linked_entities": [trigger],
            "confidence": 0.82,
        }
        for name, trigger in candidates if trigger
    ]


def _default_actions(logic_rules: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    return [
        {
            "name_cn": f"执行{rule['name_cn']}",
            "linked_logic_names": [rule["name_cn"]],
            "function_code": "def run(context):\n    return {'status': 'manual_review'}",
            "confidence": 0.78,
        }
        for rule in logic_rules
    ]


def _entity(name: str, entity_type: str, description: str) -> Dict[str, Any]:
    return {
        "name_cn": name.strip(),
        "type": entity_type,
        "description": description,
        "properties": {},
        "confidence": 0.82,
    }


def _relation(source: str, target: str, relation_type: str) -> Dict[str, Any]:
    return {"source": source, "target": target, "type": relation_type, "confidence": 0.82}


def _dedup(items: List[Dict[str, Any]], keys: Tuple[str, ...]) -> List[Dict[str, Any]]:
    seen = set()
    output = []
    for item in items:
        if not isinstance(item, dict):
            continue
        key = tuple(item.get(field) for field in keys)
        if key in seen or any(value in (None, "") for value in key):
            continue
        seen.add(key)
        output.append(item)
    return output


def _document_type(document_name: str, text: str) -> str:
    for keyword in ["合同", "材料清单", "合规控制点", "流程图", "审查意见", "本体模型", "PRD", "报表"]:
        if keyword in document_name or keyword in text[:500]:
            return keyword
    return "业务"
