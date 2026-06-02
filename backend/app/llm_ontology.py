from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import Any, Dict, Optional

from openai import OpenAI

from .ontoprompt_adapter import extract_ontology_from_text, parse_llm_json, validate_and_calibrate


DEFAULT_SYSTEM_PROMPT = """你是金融业务本体工程师。请从材料文本中抽取业务本体，输出严格 JSON。
JSON 字段：
- entities: 数组。每项包含 name_cn, type, description, properties, confidence。
- relations: 数组。每项包含 source, target, type, confidence。
- logic_rules: 数组。每项包含 name_cn, type, formula, linked_entities, confidence。
- actions: 数组。每项包含 name_cn, linked_logic_names, function_code, confidence。
实体 type 只能优先使用：Project, Subject, Contract, Collateral, Receivable, Invoice, Document, Rule, Disbursement。
关系 type 使用英文大写短语，例如 HAS_DOCUMENT, HAS_PARTY, INVOLVES, GUARANTEES, SECURED_BY。
不要输出 Markdown，不要输出解释文字。"""

DEFAULT_LLM_TIMEOUT_SECONDS = 45
DEFAULT_EXTRACTION_WINDOW = 8000
_EXECUTOR = ThreadPoolExecutor(max_workers=4)


def extract_with_config(
    text: str,
    document_name: str,
    settings: Dict[str, Any],
    agent_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    config = agent_config or {}
    allow_fallback = bool(config.get("allow_fallback", True))
    if not settings.get("enabled") or not settings.get("api_key") or not text.strip():
        return _fallback_or_failed(text, document_name, allow_fallback, "LLM 未启用、未配置 Key 或材料文本为空")

    timeout_seconds = int(config.get("timeout_seconds") or DEFAULT_LLM_TIMEOUT_SECONDS)
    future = _EXECUTOR.submit(extract_with_llm, text, document_name, settings, config)
    try:
        result = future.result(timeout=timeout_seconds)
        result["extraction_source"] = "llm"
        return result
    except TimeoutError:
        future.cancel()
        return _fallback_or_failed(text, document_name, allow_fallback, f"LLM 调用超过 {timeout_seconds} 秒")
    except Exception as exc:
        return _fallback_or_failed(text, document_name, allow_fallback, str(exc))


def extract_with_llm(
    text: str,
    document_name: str,
    settings: Dict[str, Any],
    agent_config: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    config = agent_config or {}
    client = OpenAI(
        api_key=settings["api_key"],
        base_url=settings.get("base_url") or "https://api.openai.com/v1",
        timeout=float(config.get("timeout_seconds") or DEFAULT_LLM_TIMEOUT_SECONDS) + 10,
    )
    model = settings.get("model") or "gpt-4.1-mini"
    sample = text[: int(config.get("extraction_window") or DEFAULT_EXTRACTION_WINDOW)]
    response = client.chat.completions.create(
        model=model,
        temperature=float(settings.get("temperature", 0.2)),
        messages=[
            {"role": "system", "content": config.get("system_prompt") or DEFAULT_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": json.dumps(
                    {
                        "document_name": document_name,
                        "document_text": sample,
                    },
                    ensure_ascii=False,
                ),
            },
        ],
    )
    content = response.choices[0].message.content or "{}"
    parsed = parse_llm_json(content)
    return validate_and_calibrate(parsed)


def _fallback_or_failed(text: str, document_name: str, allow_fallback: bool, message: str) -> Dict[str, Any]:
    if allow_fallback:
        result = extract_ontology_from_text(text, document_name)
        result["extraction_source"] = "local_fallback"
        result["llm_error"] = f"{message}，已切换到本地 fallback"
        return result
    return {
        "entities": [],
        "relations": [],
        "logic_rules": [],
        "actions": [],
        "extraction_source": "failed",
        "llm_error": message,
        "validation_report": {
            "has_fatal": True,
            "has_errors": True,
            "total_issues": 1,
            "by_severity": {"error": [{"message": message}]},
        },
    }


def test_llm_connection(settings: Dict[str, Any]) -> Dict[str, Any]:
    if not settings.get("api_key"):
        return {"status": "missing_key", "message": "请先配置 LLM API Key。"}
    client = OpenAI(
        api_key=settings["api_key"],
        base_url=settings.get("base_url") or "https://api.openai.com/v1",
        timeout=30.0,
    )
    response = client.chat.completions.create(
        model=settings.get("model") or "gpt-4.1-mini",
        temperature=0,
        max_tokens=16,
        messages=[
            {"role": "system", "content": "只输出 pong"},
            {"role": "user", "content": "ping"},
        ],
    )
    content = (response.choices[0].message.content or "").strip()
    return {"status": "ready", "message": f"LLM 连接成功：{content[:20] or 'ok'}"}
