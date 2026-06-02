from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from typing import Any, Callable, Dict, Iterable, List, Optional

import psycopg2
import psycopg2.extras

from .document_parser import SUPPORTED_EXTENSIONS, parse_document
from .ontoprompt_adapter import extract_ontology_from_text


ROOT_DIR = Path(__file__).resolve().parents[2]
DATA_DIR = ROOT_DIR / "data" / "workspaces" / "default"
FINANCE_DIR = ROOT_DIR.parent / "金融客户资料" / "融保贷业务分析_副本"
DATABASE_URL = os.getenv("DATABASE_URL", "postgresql://onto:onto@127.0.0.1:5434/onto_pro")


def connect():
    return psycopg2.connect(DATABASE_URL)


def fetch_all(sql: str, params: Iterable[Any] = ()) -> List[Dict[str, Any]]:
    with connect() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cursor:
        cursor.execute(sql, tuple(params))
        return [dict(row) for row in cursor.fetchall()]


def fetch_one(sql: str, params: Iterable[Any] = ()) -> Optional[Dict[str, Any]]:
    rows = fetch_all(sql, params)
    return rows[0] if rows else None


def execute(sql: str, params: Iterable[Any] = ()) -> None:
    with connect() as conn, conn.cursor() as cursor:
        cursor.execute(sql, tuple(params))


def init_schema() -> None:
    statements = [
        """
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          code TEXT,
          name TEXT NOT NULL,
          type TEXT,
          subject TEXT,
          stage TEXT,
          material_completion NUMERIC DEFAULT 0,
          risk_level TEXT,
          owner TEXT,
          updated_at TEXT,
          feature_flags JSONB DEFAULT '{}'::jsonb
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS documents (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          name TEXT NOT NULL,
          type TEXT,
          stage TEXT,
          status TEXT,
          confidence NUMERIC DEFAULT 0,
          location TEXT,
          extension TEXT,
          char_count INTEGER DEFAULT 0,
          content TEXT DEFAULT '',
          snippets JSONB DEFAULT '[]'::jsonb,
          extraction_source TEXT DEFAULT 'not_started',
          extraction_error TEXT DEFAULT ''
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS extraction_fields (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          name TEXT,
          value TEXT,
          confidence NUMERIC,
          evidence TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS object_types (
          id TEXT PRIMARY KEY,
          name TEXT,
          status TEXT,
          definition TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS relation_types (
          id TEXT PRIMARY KEY,
          name TEXT,
          status TEXT,
          source TEXT,
          target TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS rules (
          id TEXT PRIMARY KEY,
          name TEXT,
          scenario_id TEXT,
          severity TEXT,
          mock_result TEXT,
          definition TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS scenarios (
          id TEXT PRIMARY KEY,
          name TEXT,
          priority TEXT,
          status TEXT,
          description TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS eval_suites (
          id TEXT PRIMARY KEY,
          name TEXT,
          priority TEXT,
          case_count INTEGER,
          description TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS eval_cases (
          id TEXT PRIMARY KEY,
          suite_id TEXT REFERENCES eval_suites(id) ON DELETE CASCADE,
          name TEXT,
          priority TEXT,
          ontology_depth TEXT,
          mock_status TEXT
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS simulation_templates (
          id TEXT PRIMARY KEY,
          name TEXT,
          status TEXT,
          description TEXT,
          payload JSONB DEFAULT '{}'::jsonb
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ontology_entities (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          name TEXT,
          type TEXT,
          description TEXT,
          confidence NUMERIC,
          properties JSONB DEFAULT '{}'::jsonb
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ontology_relations (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          source TEXT,
          target TEXT,
          type TEXT,
          confidence NUMERIC
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS ontology_logic_rules (
          id TEXT PRIMARY KEY,
          document_id TEXT REFERENCES documents(id) ON DELETE CASCADE,
          name TEXT,
          formula TEXT,
          linked_entities JSONB DEFAULT '[]'::jsonb,
          confidence NUMERIC
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS agent_runs (
          id TEXT PRIMARY KEY,
          project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
          scenario_id TEXT,
          payload JSONB,
          created_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS feedback_items (
          id TEXT PRIMARY KEY,
          run_id TEXT,
          project_id TEXT,
          rating TEXT,
          comment TEXT,
          save_as_eval_case BOOLEAN DEFAULT FALSE,
          created_at TIMESTAMPTZ DEFAULT now()
        )
        """,
        """
        CREATE TABLE IF NOT EXISTS llm_settings (
          id TEXT PRIMARY KEY DEFAULT 'default',
          provider TEXT,
          model TEXT,
          base_url TEXT,
          api_key TEXT,
          temperature NUMERIC,
          enabled BOOLEAN DEFAULT FALSE
        )
        """,
    ]
    with connect() as conn, conn.cursor() as cursor:
        for statement in statements:
            cursor.execute(statement)
        cursor.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_source TEXT DEFAULT 'not_started'")
        cursor.execute("ALTER TABLE documents ADD COLUMN IF NOT EXISTS extraction_error TEXT DEFAULT ''")


def seed_base_data() -> None:
    init_schema()
    projects = _read_json("projects.json")
    for project in projects:
        execute(
            """
            INSERT INTO projects (id, code, name, type, subject, stage, material_completion, risk_level, owner, updated_at, feature_flags)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
              code=EXCLUDED.code, name=EXCLUDED.name, type=EXCLUDED.type, subject=EXCLUDED.subject,
              stage=EXCLUDED.stage, material_completion=EXCLUDED.material_completion,
              risk_level=EXCLUDED.risk_level, owner=EXCLUDED.owner, updated_at=EXCLUDED.updated_at,
              feature_flags=EXCLUDED.feature_flags
            """,
            (
                project["id"], project["code"], project["name"], project["type"], project["subject"],
                project["stage"], project["material_completion"], project["risk_level"], project["owner"],
                project["updated_at"], json.dumps(project.get("feature_flags", {}), ensure_ascii=False),
            ),
        )

    _seed_documents(_read_json("documents.json"))
    _seed_extractions(_read_json("extractions.json"))
    _seed_simple("object_types", _read_json("ontology/object_types.json"), ["id", "name", "status", "definition"])
    _seed_simple("relation_types", _read_json("ontology/relation_types.json"), ["id", "name", "status", "source", "target"])
    _seed_simple("rules", _read_json("ontology/rules.json"), ["id", "name", "scenario_id", "severity", "mock_result", "definition"])
    _seed_simple("scenarios", _read_json("ontology/scenarios.json"), ["id", "name", "priority", "status", "description"])
    _seed_simple("eval_suites", _read_json("eval/suites.json"), ["id", "name", "priority", "case_count", "description"])
    _seed_simple("eval_cases", _read_json("eval/cases.json"), ["id", "suite_id", "name", "priority", "ontology_depth", "mock_status"])

    templates = _read_json("simulations/templates.json")
    for item in templates:
        execute(
            """
            INSERT INTO simulation_templates (id, name, status, description, payload)
            VALUES (%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name,status=EXCLUDED.status,description=EXCLUDED.description,payload=EXCLUDED.payload
            """,
            (item["id"], item["name"], item["status"], item["description"], json.dumps(item, ensure_ascii=False)),
        )


def ingest_financial_documents(
    extractor: Optional[Callable[[str, str], Dict[str, Any]]] = None,
) -> Dict[str, Any]:
    seed_base_data()
    paths = [
        path for path in FINANCE_DIR.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    ]
    imported = 0
    failed = 0
    entities = 0
    relations = 0
    logic_rules = 0
    llm_documents = 0
    fallback_documents = 0

    for path in paths:
        project_id = "project_qsl_001" if "租赁" in str(path) else "project_gc_001"
        try:
            parsed = parse_document(path)
        except Exception as exc:
            failed += 1
            parsed = {
                "extension": path.suffix.lower(),
                "char_count": 0,
                "text": "",
                "snippets": [f"解析失败：{exc}"],
            }
        document_id = f"file_{uuid.uuid5(uuid.NAMESPACE_URL, str(path))}"
        doc_type = _guess_doc_type(path.name)
        stage = "租赁" if project_id == "project_qsl_001" else "保理"
        execute("DELETE FROM ontology_entities WHERE document_id=%s", (document_id,))
        execute("DELETE FROM ontology_relations WHERE document_id=%s", (document_id,))
        execute("DELETE FROM ontology_logic_rules WHERE document_id=%s", (document_id,))
        result = extractor(str(parsed["text"]), path.name) if extractor else extract_ontology_from_text(str(parsed["text"]), path.name)
        source = result.get("extraction_source", "local_fallback" if not extractor else "llm")
        error = result.get("llm_error", "")
        if source == "llm":
            llm_documents += 1
        else:
            fallback_documents += 1
        execute(
            """
            INSERT INTO documents (
              id, project_id, name, type, stage, status, confidence, location, extension,
              char_count, content, snippets, extraction_source, extraction_error
            )
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET
              type=EXCLUDED.type, stage=EXCLUDED.stage, status=EXCLUDED.status, confidence=EXCLUDED.confidence,
              location=EXCLUDED.location, extension=EXCLUDED.extension, char_count=EXCLUDED.char_count,
              content=EXCLUDED.content, snippets=EXCLUDED.snippets,
              extraction_source=EXCLUDED.extraction_source, extraction_error=EXCLUDED.extraction_error
            """,
            (
                document_id, project_id, path.name, doc_type, stage, "parsed" if parsed["text"] else "needs_review",
                0.9 if source == "llm" else 0.76 if parsed["text"] else 0.45,
                str(path), parsed["extension"], parsed["char_count"], parsed["text"],
                json.dumps(parsed["snippets"], ensure_ascii=False), source, error,
            ),
        )
        for entity in result.get("entities", []):
            execute(
                """
                INSERT INTO ontology_entities (id, document_id, name, type, description, confidence, properties)
                VALUES (%s,%s,%s,%s,%s,%s,%s)
                """,
                (
                    str(uuid.uuid4()), document_id, entity.get("name_cn"), entity.get("type"),
                    entity.get("description"), entity.get("confidence"),
                    json.dumps(entity.get("properties", {}), ensure_ascii=False),
                ),
            )
            entities += 1
        for relation in result.get("relations", []):
            execute(
                "INSERT INTO ontology_relations (id, document_id, source, target, type, confidence) VALUES (%s,%s,%s,%s,%s,%s)",
                (str(uuid.uuid4()), document_id, relation.get("source"), relation.get("target"), relation.get("type"), relation.get("confidence")),
            )
            relations += 1
        for rule in result.get("logic_rules", []):
            execute(
                "INSERT INTO ontology_logic_rules (id, document_id, name, formula, linked_entities, confidence) VALUES (%s,%s,%s,%s,%s,%s)",
                (
                    str(uuid.uuid4()), document_id, rule.get("name_cn"), rule.get("formula"),
                    json.dumps(rule.get("linked_entities", []), ensure_ascii=False), rule.get("confidence"),
                ),
            )
            logic_rules += 1
        imported += 1

    return {
        "documents": imported,
        "failed": failed,
        "llm_documents": llm_documents,
        "fallback_documents": fallback_documents,
        "entities": entities,
        "relations": relations,
        "logic_rules": logic_rules,
    }


def document_content(document_id: str) -> Optional[Dict[str, Any]]:
    return fetch_one(
        """
        SELECT id, name, content, snippets, extraction_source, extraction_error
        FROM documents WHERE id=%s
        """,
        (document_id,),
    )


def replace_document_ontology(document_id: str, result: Dict[str, Any]) -> Dict[str, Any]:
    execute("DELETE FROM ontology_entities WHERE document_id=%s", (document_id,))
    execute("DELETE FROM ontology_relations WHERE document_id=%s", (document_id,))
    execute("DELETE FROM ontology_logic_rules WHERE document_id=%s", (document_id,))
    for entity in result.get("entities", []):
        execute(
            """
            INSERT INTO ontology_entities (id, document_id, name, type, description, confidence, properties)
            VALUES (%s,%s,%s,%s,%s,%s,%s)
            """,
            (
                str(uuid.uuid4()), document_id, entity.get("name_cn"), entity.get("type"),
                entity.get("description"), entity.get("confidence"),
                json.dumps(entity.get("properties", {}), ensure_ascii=False),
            ),
        )
    for relation in result.get("relations", []):
        execute(
            "INSERT INTO ontology_relations (id, document_id, source, target, type, confidence) VALUES (%s,%s,%s,%s,%s,%s)",
            (str(uuid.uuid4()), document_id, relation.get("source"), relation.get("target"), relation.get("type"), relation.get("confidence")),
        )
    for rule in result.get("logic_rules", []):
        execute(
            "INSERT INTO ontology_logic_rules (id, document_id, name, formula, linked_entities, confidence) VALUES (%s,%s,%s,%s,%s,%s)",
            (
                str(uuid.uuid4()), document_id, rule.get("name_cn"), rule.get("formula"),
                json.dumps(rule.get("linked_entities", []), ensure_ascii=False), rule.get("confidence"),
            ),
        )
    execute(
        """
        UPDATE documents SET extraction_source=%s, extraction_error=%s, confidence=%s WHERE id=%s
        """,
        (
            result.get("extraction_source", "llm"),
            result.get("llm_error", ""),
            0.9 if result.get("extraction_source") == "llm" else 0.76,
            document_id,
        ),
    )
    return {
        "entities": len(result.get("entities", [])),
        "relations": len(result.get("relations", [])),
        "logic_rules": len(result.get("logic_rules", [])),
        "extraction_source": result.get("extraction_source", "llm"),
        "llm_error": result.get("llm_error", ""),
    }


def get_llm_settings(defaults: Dict[str, Any]) -> Dict[str, Any]:
    init_schema()
    row = fetch_one("SELECT provider, model, base_url, api_key, temperature::float, enabled FROM llm_settings WHERE id=%s", ("default",))
    settings = dict(defaults)
    if row:
        settings.update({key: value for key, value in row.items() if value is not None})
    return settings


def save_llm_settings(settings: Dict[str, Any]) -> None:
    init_schema()
    execute(
        """
        INSERT INTO llm_settings (id, provider, model, base_url, api_key, temperature, enabled)
        VALUES ('default', %s, %s, %s, %s, %s, %s)
        ON CONFLICT (id) DO UPDATE SET
          provider=EXCLUDED.provider,
          model=EXCLUDED.model,
          base_url=EXCLUDED.base_url,
          api_key=EXCLUDED.api_key,
          temperature=EXCLUDED.temperature,
          enabled=EXCLUDED.enabled
        """,
        (
            settings.get("provider"),
            settings.get("model"),
            settings.get("base_url"),
            settings.get("api_key", ""),
            settings.get("temperature", 0.2),
            bool(settings.get("enabled")),
        ),
    )


def graph_data(project_id: Optional[str] = None) -> Dict[str, Any]:
    where = "WHERE d.project_id=%s" if project_id else ""
    params = (project_id,) if project_id else ()
    entities = fetch_all(
        f"""
        SELECT e.name AS id, e.name AS label, e.type, AVG(e.confidence)::float AS confidence, COUNT(*)::int AS count
        FROM ontology_entities e
        JOIN documents d ON d.id=e.document_id
        {where}
        GROUP BY e.name, e.type
        ORDER BY count DESC, e.name
        LIMIT 120
        """,
        params,
    )
    relations = fetch_all(
        f"""
        SELECT r.source, r.target, r.type, AVG(r.confidence)::float AS confidence
        FROM ontology_relations r
        JOIN documents d ON d.id=r.document_id
        {where}
        GROUP BY r.source, r.target, r.type
        LIMIT 180
        """,
        params,
    )
    return {"nodes": entities, "edges": relations}


def _read_json(relative_path: str) -> Any:
    return json.loads((DATA_DIR / relative_path).read_text(encoding="utf-8"))


def _seed_documents(items: List[Dict[str, Any]]) -> None:
    for item in items:
        execute(
            """
            INSERT INTO documents (id, project_id, name, type, stage, status, confidence, location)
            VALUES (%s,%s,%s,%s,%s,%s,%s,%s)
            ON CONFLICT (id) DO UPDATE SET project_id=EXCLUDED.project_id,name=EXCLUDED.name,type=EXCLUDED.type,
            stage=EXCLUDED.stage,status=EXCLUDED.status,confidence=EXCLUDED.confidence,location=EXCLUDED.location
            """,
            (item["id"], item["project_id"], item["name"], item["type"], item["stage"], item["status"], item["confidence"], item["location"]),
        )


def _seed_extractions(items: List[Dict[str, Any]]) -> None:
    for item in items:
        execute("DELETE FROM extraction_fields WHERE document_id=%s", (item["document_id"],))
        for field in item.get("fields", []):
            execute(
                "INSERT INTO extraction_fields (id, document_id, name, value, confidence, evidence) VALUES (%s,%s,%s,%s,%s,%s)",
                (str(uuid.uuid4()), item["document_id"], field["name"], field["value"], field["confidence"], field["evidence"]),
            )


def _seed_simple(table: str, items: List[Dict[str, Any]], columns: List[str]) -> None:
    placeholders = ",".join(["%s"] * len(columns))
    assignments = ",".join([f"{column}=EXCLUDED.{column}" for column in columns if column != "id"])
    sql = f"""
    INSERT INTO {table} ({','.join(columns)}) VALUES ({placeholders})
    ON CONFLICT (id) DO UPDATE SET {assignments}
    """
    for item in items:
        execute(sql, tuple(item.get(column) for column in columns))


def _guess_doc_type(name: str) -> str:
    for keyword in ["合同", "合规控制点", "材料清单", "流程图", "审查意见", "本体模型", "PRD", "报表", "方案"]:
        if keyword in name:
            return keyword
    return "业务资料"
