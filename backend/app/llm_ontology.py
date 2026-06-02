from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor, TimeoutError
from typing import Any, Dict

from openai import OpenAI

from .ontoprompt_adapter import extract_ontology_from_text, parse_llm_json, validate_and_calibrate


SYSTEM_PROMPT = """你是金融业务本体工程师。请从材料文本中抽取业务本体，输出严格 JSON。
JSON 字段：
- entities: 数组。每项包含 name_cn, type, description, properties, confidence。
- relations: 数组。每项包含 source, target, type, confidence。
- logic_rules: 数组。每项包含 name_cn, type, formula, linked_entities, confidence。
- actions: 数组。每项包含 name_cn, linked_logic_names, function_code, confidence。
实体 type 只能优先使用：Project, Subject, Contract, Collateral, Receivable, Invoice, Document, Rule, Disbursement。
关系 type 使用英文大写短语，例如 HAS_DOCUMENT, HAS_PARTY, INVOLVES, GUARANTEES, SECURED_BY。
不要输出 Markdown，不要输出解释文字。"""

LLM_TIMEOUT_SECONDS = 45
_EXECUTOR = ThreadPoolExecutor(max_workers=4)


def extract_with_config(text: str, document_name: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    if not settings.get("enabled") or not settings.get("api_key") or not text.strip():
        result = extract_ontology_from_text(text, document_name)
        result["extraction_source"] = "local_fallback"
        return result

    future = _EXECUTOR.submit(extract_with_llm, text, document_name, settings)
    try:
        result = future.result(timeout=LLM_TIMEOUT_SECONDS)
        result["extraction_source"] = "llm"
        return result
    except TimeoutError:
        future.cancel()
        result = extract_ontology_from_text(text, document_name)
        result["extraction_source"] = "local_fallback"
        result["llm_error"] = f"LLM 调用超过 {LLM_TIMEOUT_SECONDS} 秒，已切换到本地 fallback"
        return result
    except Exception as exc:
        result = extract_ontology_from_text(text, document_name)
        result["extraction_source"] = "local_fallback"
        result["llm_error"] = str(exc)
        return result


def extract_with_llm(text: str, document_name: str, settings: Dict[str, Any]) -> Dict[str, Any]:
    client = OpenAI(
        api_key=settings["api_key"],
        base_url=settings.get("base_url") or "https://api.openai.com/v1",
        timeout=60.0,
    )
    model = settings.get("model") or "gpt-4.1-mini"
    sample = text[:8000]
    response = client.chat.completions.create(
        model=model,
        temperature=float(settings.get("temperature", 0.2)),
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
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
