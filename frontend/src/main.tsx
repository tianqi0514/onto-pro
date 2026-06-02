import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import * as THREE from "three";
import {
  Activity,
  AlertTriangle,
  Beaker,
  Bot,
  Brain,
  CheckCircle2,
  CloudUpload,
  FileText,
  GitBranch,
  KeyRound,
  Layers3,
  Play,
  RefreshCw,
  Save,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import "./styles.css";

const API_BASE = "";
const sourceLabels: Record<string, string> = {
  active: "已接入",
  local_file_mock: "本地文件",
  manual_annotation_mock: "人工标注",
  llm: "LLM 生成",
  local_fallback: "本地 fallback",
  not_started: "未开始",
  offline_sample: "离线样例",
  development: "开发中",
  api_mock: "样例接口",
  frontend: "前端已接入"
};

type Project = {
  id: string;
  code: string;
  name: string;
  type: string;
  subject: string;
  stage: string;
  material_completion: number;
  risk_level: string;
  owner: string;
  updated_at: string;
  feature_flags: Record<string, string>;
};

type DocumentItem = {
  id: string;
  project_id: string;
  name: string;
  type: string;
  stage: string;
  status: string;
  confidence: number;
  location: string;
  extraction_source?: string;
  extraction_error?: string;
};

type Scenario = {
  id: string;
  name: string;
  priority: string;
  status: string;
  description: string;
};

type Rule = {
  id: string;
  name: string;
  scenario_id: string;
  severity: string;
  mock_result: string;
  definition: string;
};

type AgentRun = {
  run_id: string;
  llm: { provider: string; model: string; configured: boolean; enabled: boolean };
  matched_scenario: { id: string; name: string; confidence: number };
  skills_called: Array<{ name: string; status: string; mode: string }>;
  rules_applied: Array<{ rule_id: string; rule_name: string; result: string }>;
  reasoning_trace: Array<{ step: number; type: string; description: string }>;
  evidence: Array<{ source: string; location: string; excerpt_or_value: string }>;
  uncertainty: Array<{ issue: string; impact: string; required_action: string }>;
  conclusion: { summary: string; risk_level: string };
};

type EvalSuite = {
  id: string;
  name: string;
  priority: string;
  case_count: number;
  description: string;
};

type EvalRun = {
  eval_run_id: string;
  status: string;
  total: number;
  passed: number;
  pass_rate: number;
  boundary_summary: Record<string, string>;
  cases: Array<{ id: string; name: string; priority: string; ontology_depth: string; mock_status: string }>;
};

type SimulationTemplate = {
  id: string;
  name: string;
  status: string;
  description: string;
  default_assumptions: Array<{ name: string; before_value: string; simulated_value: string; source: string }>;
};

type Extraction = {
  document_id: string;
  input_quality: string;
  fields: Array<{ name: string; value: string; confidence: number; evidence: string }>;
};

type ObjectType = {
  id: string;
  name: string;
  status: string;
  definition: string;
};

type RelationType = {
  id: string;
  name: string;
  status: string;
  source: string;
  target: string;
};

type SimulationRun = {
  simulation_run_id: string;
  status: string;
  assumptions: Array<{ name: string; before_value: string; simulated_value: string; source: string }>;
  diff: Array<{ target: string; name: string; before: string; after: string; impact: string }>;
  rules_changed: Array<{ rule_id: string; before_result: string; after_result: string }>;
  impact_paths: Array<{ path: string[]; description: string }>;
  conclusion: { summary: string; risk_level_after: string; disclaimer: string };
};

type LlmSettings = {
  provider: string;
  model: string;
  base_url: string;
  temperature: number;
  enabled: boolean;
  configured: boolean;
  api_key_masked: string;
};

type LlmForm = {
  provider: string;
  model: string;
  base_url: string;
  temperature: number;
  enabled: boolean;
  api_key: string;
};

type RuleTestResult = {
  rule_id: string;
  rule_name: string;
  result: string;
  facts: Array<{ name: string; value: string | number }>;
  evidence: string[];
};

type GraphData = {
  nodes: Array<{ id: string; label: string; type: string; confidence: number; count: number }>;
  edges: Array<{ source: string; target: string; type: string; confidence: number }>;
};

type ActiveSection = "projects" | "documents" | "ontology" | "agent" | "eval" | "simulation" | "settings";

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  if (!response.ok) {
    throw new Error(await response.text());
  }
  return response.json();
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function badgeClass(status: string) {
  if (["active", "parsed", "passed", "completed", "hit", "llm"].includes(status)) return "badge good";
  if (["development", "needs_review", "manual_review", "local_fallback"].includes(status)) return "badge warn";
  return "badge";
}

function sourceText(value: string) {
  return sourceLabels[value] ?? value;
}

const navigationItems: Array<{ id: ActiveSection; label: string; icon: typeof Layers3 }> = [
  { id: "projects", label: "项目", icon: Layers3 },
  { id: "documents", label: "材料", icon: FileText },
  { id: "ontology", label: "本体", icon: GitBranch },
  { id: "agent", label: "Agent", icon: Bot },
  { id: "eval", label: "评测", icon: Beaker },
  { id: "simulation", label: "推演", icon: SlidersHorizontal },
  { id: "settings", label: "设置", icon: Settings }
];

function OntologyGraph3D({ data }: { data: GraphData }) {
  const mountRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || 640;
    const height = mount.clientHeight || 380;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color("#0e171d");
    const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 2000);
    camera.position.set(0, 110, 260);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    mount.appendChild(renderer.domElement);

    const group = new THREE.Group();
    scene.add(group);
    scene.add(new THREE.AmbientLight("#ffffff", 1.1));
    const point = new THREE.PointLight("#b9f6e4", 1.5, 500);
    point.position.set(90, 120, 120);
    scene.add(point);

    const colors: Record<string, string> = {
      Project: "#14b8a6",
      Subject: "#38bdf8",
      Contract: "#f59e0b",
      Collateral: "#a78bfa",
      Receivable: "#22c55e",
      Invoice: "#f97316",
      Document: "#94a3b8",
      Rule: "#ef4444",
      Disbursement: "#eab308",
    };

    const nodes = data.nodes.slice(0, 90);
    const positions = new Map<string, THREE.Vector3>();
    const nodeMaterialCache = new Map<string, THREE.MeshStandardMaterial>();
    const sphere = new THREE.SphereGeometry(4.6, 24, 24);

    nodes.forEach((node, index) => {
      const layer = Math.floor(index / 18);
      const slot = index % 18;
      const radius = 45 + layer * 34;
      const angle = (slot / Math.min(18, nodes.length)) * Math.PI * 2 + layer * 0.45;
      const y = (layer - 2) * 18 + Math.sin(angle * 2) * 12;
      const position = new THREE.Vector3(Math.cos(angle) * radius, y, Math.sin(angle) * radius);
      positions.set(node.id, position);

      const color = colors[node.type] ?? "#cbd5e1";
      let material = nodeMaterialCache.get(color);
      if (!material) {
        material = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.18 });
        nodeMaterialCache.set(color, material);
      }
      const mesh = new THREE.Mesh(sphere, material);
      mesh.position.copy(position);
      mesh.scale.setScalar(0.85 + Math.min(node.count, 5) * 0.09);
      group.add(mesh);
    });

    data.edges.slice(0, 150).forEach((edge) => {
      const source = positions.get(edge.source);
      const target = positions.get(edge.target);
      if (!source || !target) return;
      const geometry = new THREE.BufferGeometry().setFromPoints([source, target]);
      const line = new THREE.Line(
        geometry,
        new THREE.LineBasicMaterial({
          color: "#7dd3fc",
          transparent: true,
          opacity: 0.24 + Math.min(edge.confidence ?? 0.4, 1) * 0.24,
        })
      );
      group.add(line);
    });

    let frame = 0;
    const animate = () => {
      group.rotation.y += 0.0024;
      group.rotation.x = Math.sin(Date.now() / 3600) * 0.08;
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    const resizeObserver = new ResizeObserver(([entry]) => {
      const nextWidth = entry.contentRect.width;
      const nextHeight = entry.contentRect.height;
      if (!nextWidth || !nextHeight) return;
      camera.aspect = nextWidth / nextHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(nextWidth, nextHeight);
    });
    resizeObserver.observe(mount);

    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      mount.removeChild(renderer.domElement);
      sphere.dispose();
      nodeMaterialCache.forEach((material) => material.dispose());
      renderer.dispose();
    };
  }, [data]);

  if (!data.nodes.length) {
    return (
      <div className="graph-empty">
        <GitBranch size={22} />
        <span>导入金融客户资料后生成 3D 本体图谱</span>
      </div>
    );
  }

  return (
    <div className="graph-shell">
      <div className="graph-canvas" ref={mountRef} />
      <div className="graph-meta">
        <span>{data.nodes.length} 对象</span>
        <span>{data.edges.length} 关系</span>
      </div>
    </div>
  );
}

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [evalSuites, setEvalSuites] = useState<EvalSuite[]>([]);
  const [simTemplates, setSimTemplates] = useState<SimulationTemplate[]>([]);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null);
  const [llmForm, setLlmForm] = useState<LlmForm>({
    provider: "openai",
    model: "gpt-4.1-mini",
    base_url: "https://api.openai.com/v1",
    temperature: 0.2,
    enabled: false,
    api_key: ""
  });
  const [activeSection, setActiveSection] = useState<ActiveSection>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState("project_qsl_001");
  const [selectedScenarioId, setSelectedScenarioId] = useState("scenario.leasing_risk_review");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [evalRun, setEvalRun] = useState<EvalRun | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
  const [ruleTestResult, setRuleTestResult] = useState<RuleTestResult | null>(null);
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [feedbackRating, setFeedbackRating] = useState("correct");
  const [feedbackComment, setFeedbackComment] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [llmTestMessage, setLlmTestMessage] = useState("");
  const [systemMessage, setSystemMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId),
    [scenarios, selectedScenarioId]
  );

  const selectedDocument = useMemo(
    () => documents.find((document) => document.id === selectedDocumentId),
    [documents, selectedDocumentId]
  );

  useEffect(() => {
    async function load() {
      const [projectData, scenarioData, ruleData, suiteData, templateData, objectData, relationData, llmData] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<Scenario[]>("/api/scenarios"),
        api<Rule[]>("/api/rules"),
        api<EvalSuite[]>("/api/eval/suites"),
        api<SimulationTemplate[]>("/api/simulations/templates"),
        api<ObjectType[]>("/api/ontology/object-types"),
        api<RelationType[]>("/api/ontology/relation-types"),
        api<LlmSettings>("/api/settings/llm")
      ]);
      setProjects(projectData);
      setScenarios(scenarioData);
      setRules(ruleData);
      setEvalSuites(suiteData);
      setSimTemplates(templateData);
      setObjectTypes(objectData);
      setRelationTypes(relationData);
      setLlmSettings(llmData);
      setLlmForm({
        provider: llmData.provider,
        model: llmData.model,
        base_url: llmData.base_url,
        temperature: llmData.temperature,
        enabled: llmData.enabled,
        api_key: ""
      });
    }
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    api<DocumentItem[]>(`/api/projects/${selectedProjectId}/documents`)
      .then((items) => {
        setDocuments(items);
        setSelectedDocumentId(items[0]?.id ?? null);
      })
      .catch(console.error);
  }, [selectedProjectId]);

  useEffect(() => {
    refreshGraph().catch(console.error);
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedDocumentId) {
      setExtraction(null);
      return;
    }
    api<Extraction>(`/api/documents/${selectedDocumentId}/extraction`).then(setExtraction).catch(console.error);
  }, [selectedDocumentId]);

  async function runAgent() {
    setLoading(true);
    try {
      const result = await api<AgentRun>("/api/agent/runs", {
        method: "POST",
        body: JSON.stringify({ project_id: selectedProjectId, task_id: selectedScenarioId })
      });
      setAgentRun(result);
    } finally {
      setLoading(false);
    }
  }

  async function saveFeedback(saveAsEvalCase = false) {
    if (!agentRun) return;
    setLoading(true);
    try {
      const result = await api<{ status: string }> (`/api/agent/runs/${agentRun.run_id}/feedback`, {
        method: "POST",
        body: JSON.stringify({
          run_id: agentRun.run_id,
          project_id: selectedProjectId,
          rating: feedbackRating,
          comment: feedbackComment,
          save_as_eval_case: saveAsEvalCase
        })
      });
      setFeedbackStatus(result.status === "saved" ? "反馈已保存" : "已提交");
      setFeedbackComment("");
    } finally {
      setLoading(false);
    }
  }

  async function testRule(ruleId: string) {
    setLoading(true);
    try {
      const result = await api<RuleTestResult>(`/api/rules/${ruleId}/test`, {
        method: "POST",
        body: JSON.stringify({ project_id: selectedProjectId, rule_id: ruleId })
      });
      setRuleTestResult(result);
    } finally {
      setLoading(false);
    }
  }

  async function runEval() {
    const firstSuite = evalSuites[0];
    if (!firstSuite) return;
    setLoading(true);
    try {
      const result = await api<EvalRun>("/api/eval/runs", {
        method: "POST",
        body: JSON.stringify({ suite_id: firstSuite.id })
      });
      setEvalRun(result);
    } finally {
      setLoading(false);
    }
  }

  async function parseSelectedDocument() {
    if (!selectedDocumentId) return;
    setLoading(true);
    try {
      const result = await api<{ extraction: Extraction }>(`/api/documents/${selectedDocumentId}/parse`, {
        method: "POST"
      });
      setExtraction(result.extraction);
      const items = await api<DocumentItem[]>(`/api/projects/${selectedProjectId}/documents`);
      setDocuments(items);
      await refreshGraph();
    } finally {
      setLoading(false);
    }
  }

  async function runSimulation(templateId?: string) {
    const template = simTemplates.find((item) => item.id === templateId) ?? simTemplates[0];
    if (!template) return;
    setLoading(true);
    try {
      const result = await api<SimulationRun>("/api/simulations/runs", {
        method: "POST",
        body: JSON.stringify({ project_id: selectedProjectId, template_id: template.id })
      });
      setSimulationRun(result);
    } finally {
      setLoading(false);
    }
  }

  async function saveLlmSettings() {
    setLoading(true);
    try {
      const result = await api<LlmSettings>("/api/settings/llm", {
        method: "PUT",
        body: JSON.stringify(llmForm)
      });
      setLlmSettings(result);
      setLlmForm((current) => ({ ...current, api_key: "" }));
      setLlmTestMessage("LLM 配置已保存");
    } finally {
      setLoading(false);
    }
  }

  async function testLlmSettings() {
    setLoading(true);
    try {
      const result = await api<{ status: string; message: string }>("/api/settings/llm/test", {
        method: "POST"
      });
      setLlmTestMessage(result.message);
    } finally {
      setLoading(false);
    }
  }

  async function refreshGraph() {
    if (!selectedProjectId) return;
    const result = await api<GraphData>(`/api/graph?project_id=${encodeURIComponent(selectedProjectId)}`);
    setGraphData(result);
  }

  async function initDatabase() {
    setLoading(true);
    try {
      const result = await api<{ status: string; storage: string }>("/api/admin/init-db", { method: "POST" });
      setSystemMessage(`数据库已初始化：${result.storage}`);
      window.setTimeout(() => window.location.reload(), 500);
    } finally {
      setLoading(false);
    }
  }

  async function ingestFinanceDemo() {
    setLoading(true);
    try {
      const result = await api<{
        documents: number;
        failed: number;
        llm_documents: number;
        fallback_documents: number;
        entities: number;
        relations: number;
        logic_rules: number;
      }>(
        "/api/admin/ingest-finance-demo",
        { method: "POST" }
      );
      setSystemMessage(`已导入 ${result.documents} 份材料，LLM 解析 ${result.llm_documents} 份，fallback ${result.fallback_documents} 份；生成 ${result.entities} 个对象、${result.relations} 条关系、${result.logic_rules} 条规则`);
      await Promise.all([
        api<DocumentItem[]>(`/api/projects/${selectedProjectId}/documents`).then((items) => {
          setDocuments(items);
          setSelectedDocumentId(items[0]?.id ?? null);
        }),
        refreshGraph(),
      ]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <Brain size={24} />
          <div>
            <strong>Onto Pro</strong>
            <span>本体推理工作台</span>
          </div>
        </div>
        <nav>
          {navigationItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                className={activeSection === item.id ? "nav-item active" : "nav-item"}
                key={item.id}
                onClick={() => setActiveSection(item.id)}
              >
                <Icon size={18} />
                {item.label}
              </button>
            );
          })}
        </nav>
        <div className="mode-note">LLM 本体工作台</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>内部交付代管 / 本地文件优先</p>
            <h1>金融客户样板工作台</h1>
          </div>
          <div className="toolbar">
            <button className="mode-pill" onClick={() => setActiveSection("settings")} title="进入设置中心配置 LLM Key">
              {llmSettings?.configured ? `${llmSettings.provider} / ${llmSettings.model}` : "配置 LLM"}
            </button>
            <button className="icon-button" title="刷新" onClick={() => window.location.reload()}>
              <RefreshCw size={18} />
            </button>
            <button className="primary-button" onClick={runAgent} disabled={loading}>
              <Play size={18} />
              运行场景
            </button>
          </div>
        </header>

        <section className="summary-grid">
          <div className="metric">
            <span>项目数</span>
            <strong>{projects.length}</strong>
          </div>
          <div className="metric">
            <span>当前材料完成率</span>
            <strong>{selectedProject ? formatPercent(selectedProject.material_completion) : "--"}</strong>
          </div>
          <div className="metric">
            <span>P0 场景</span>
            <strong>{scenarios.filter((scenario) => scenario.priority === "P0").length}</strong>
          </div>
          <div className="metric">
            <span>可运行评测集</span>
            <strong>{evalSuites.length}</strong>
          </div>
        </section>

        <section className={`content-grid ${activeSection}`}>
          {activeSection === "projects" && (
            <>
              <div className="panel project-panel">
                <div className="panel-title">
                  <h2>项目列表</h2>
                  <Search size={18} />
                </div>
                <div className="project-list">
                  {projects.map((project) => (
                    <button
                      className={project.id === selectedProjectId ? "project-row selected" : "project-row"}
                      key={project.id}
                      onClick={() => setSelectedProjectId(project.id)}
                    >
                      <span>
                        <strong>{project.name}</strong>
                        <small>{project.code} / {project.type} / {project.stage}</small>
                      </span>
                      <em className={badgeClass(project.risk_level)}>{project.risk_level}</em>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>项目摘要</h2>
                  <ShieldCheck size={18} />
                </div>
                {selectedProject && (
                  <div className="detail-grid">
                    <label>主体<span>{selectedProject.subject}</span></label>
                    <label>负责人<span>{selectedProject.owner}</span></label>
                    <label>更新日期<span>{selectedProject.updated_at}</span></label>
                    <label>材料完成率<span>{formatPercent(selectedProject.material_completion)}</span></label>
                  </div>
                )}
                <div className="flag-row">
                  {selectedProject &&
                    Object.entries(selectedProject.feature_flags).map(([key, value]) => (
                      <span className={badgeClass(value)} key={key}>{key}: {sourceText(value)}</span>
                    ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>近期任务</h2>
                  <Activity size={18} />
                </div>
                <div className="task-list">
                  <button onClick={() => setActiveSection("documents")}>查看材料抽取</button>
                  <button onClick={() => setActiveSection("agent")}>运行尽调审查</button>
                  <button onClick={() => setActiveSection("ontology")}>查看 3D 本体图谱</button>
                  <button onClick={() => setActiveSection("eval")}>执行 P0 回归</button>
                </div>
              </div>
            </>
          )}

          {activeSection === "documents" && (
            <>
              <div className="panel wide">
                <div className="panel-title">
                  <h2>材料中心</h2>
                  <FileText size={18} />
                </div>
                <table>
                  <thead>
                    <tr>
                      <th>材料</th>
                      <th>类型</th>
                      <th>阶段</th>
                      <th>状态</th>
                      <th>抽取来源</th>
                      <th>置信度</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.map((document) => (
                      <tr
                        className={document.id === selectedDocumentId ? "selected-row" : ""}
                        key={document.id}
                        onClick={() => setSelectedDocumentId(document.id)}
                      >
                        <td>{document.name}</td>
                        <td>{document.type}</td>
                        <td>{document.stage}</td>
                        <td><span className={badgeClass(document.status)}>{document.status}</span></td>
                        <td><span className={badgeClass(document.extraction_source ?? "not_started")}>{sourceText(document.extraction_source ?? "not_started")}</span></td>
                        <td>{formatPercent(document.confidence)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>抽取结果</h2>
                  <FileText size={18} />
                </div>
                <button className="secondary-button" onClick={parseSelectedDocument} disabled={!selectedDocumentId || loading}>
                  <Play size={18} />
                  重新解析
                </button>
                {selectedDocument && (
                  <p className="context-line">{selectedDocument.name}</p>
                )}
                {extraction ? (
                  <div className="field-list">
                    {extraction.fields.map((field) => (
                      <label key={`${extraction.document_id}-${field.name}`}>
                        {field.name}
                        <span>{field.value}</span>
                        <small>{field.evidence} / {formatPercent(field.confidence)}</small>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <AlertTriangle size={20} />
                    <span>请选择一份材料</span>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === "ontology" && (
            <>
              <div className="panel graph-panel wide">
                <div className="panel-title">
                  <h2>3D 本体图谱</h2>
                  <GitBranch size={18} />
                </div>
                <OntologyGraph3D data={graphData} />
                <div className="graph-node-list">
                  {graphData.nodes.slice(0, 8).map((node) => (
                    <label key={`${node.id}-${node.type}`}>
                      {node.label}
                      <span>{node.type} / 出现 {node.count} 次 / {formatPercent(node.confidence ?? 0)}</span>
                    </label>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>对象类型</h2>
                  <GitBranch size={18} />
                </div>
                <div className="ontology-list">
                  {objectTypes.map((item) => (
                    <div className="ontology-item" key={item.id}>
                      <strong>{item.name}</strong>
                      <span className={badgeClass(item.status)}>{item.status}</span>
                      <small>{item.definition}</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>关系类型</h2>
                  <GitBranch size={18} />
                </div>
                <div className="ontology-list">
                  {relationTypes.map((item) => (
                    <div className="ontology-item" key={item.id}>
                      <strong>{item.name}</strong>
                      <span className={badgeClass(item.status)}>{item.status}</span>
                      <small>{item.source} → {item.target}</small>
                    </div>
                  ))}
                </div>
              </div>

              <div className="panel">
                <div className="panel-title">
                  <h2>规则库</h2>
                  <Activity size={18} />
                </div>
                <div className="rule-list">
                  {rules.map((rule) => (
                    <div className="rule stacked" key={rule.id}>
                      <span>{rule.name}</span>
                      <small>{rule.definition}</small>
                      <em className={badgeClass(rule.mock_result)}>{rule.mock_result}</em>
                      <button className="mini-button" onClick={() => testRule(rule.id)} disabled={loading}>测试规则</button>
                    </div>
                  ))}
                </div>
                {ruleTestResult && (
                  <div className="result-box">
                    <strong>{ruleTestResult.rule_name}</strong>
                    <span className={badgeClass(ruleTestResult.result)}>{ruleTestResult.result}</span>
                    {ruleTestResult.facts.map((fact) => (
                      <label key={fact.name}>{fact.name}<span>{fact.value}</span></label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === "agent" && (
            <>
              <div className="panel">
                <div className="panel-title">
                  <h2>场景选择</h2>
                  <Activity size={18} />
                </div>
                <div className="scenario-list">
                  {scenarios.map((scenario) => (
                    <button
                      className={scenario.id === selectedScenarioId ? "scenario selected" : "scenario"}
                      key={scenario.id}
                      onClick={() => setSelectedScenarioId(scenario.id)}
                    >
                      <strong>{scenario.name}</strong>
                      <small>{scenario.description}</small>
                    </button>
                  ))}
                </div>
                <button className="secondary-button spaced" onClick={runAgent} disabled={loading}>
                  <Play size={18} />
                  运行当前场景
                </button>
              </div>

              <div className="panel wide">
                <div className="panel-title">
                  <h2>Agent 运行</h2>
                  <Bot size={18} />
                </div>
                {agentRun ? (
                  <div className="run-detail">
                    <strong>{agentRun.matched_scenario.name}</strong>
                    <span className="subtle-meta">样例运行 / {agentRun.matched_scenario.confidence} 置信度</span>
                    <p>{agentRun.conclusion.summary}</p>
                    <div className="skill-list">
                      {agentRun.skills_called.map((skill) => (
                        <span className={badgeClass(skill.status)} key={skill.name}>
                          {skill.name}: {sourceText(skill.mode)}
                        </span>
                      ))}
                    </div>
                    <div className="trace">
                      {agentRun.reasoning_trace.map((step) => (
                        <span key={step.step}>{step.step}. {step.description}</span>
                      ))}
                    </div>
                    <div className="evidence-list">
                      {agentRun.evidence.map((item) => (
                        <label key={item.source}>{item.source}<span>{item.excerpt_or_value}</span></label>
                      ))}
                    </div>
                    <div className="feedback-box">
                      <strong>人工反馈</strong>
                      <div className="segmented">
                        {["correct", "needs_fix", "evidence_error"].map((rating) => (
                          <button
                            className={feedbackRating === rating ? "active" : ""}
                            key={rating}
                            onClick={() => setFeedbackRating(rating)}
                          >
                            {rating === "correct" ? "正确" : rating === "needs_fix" ? "需修正" : "证据错误"}
                          </button>
                        ))}
                      </div>
                      <textarea
                        value={feedbackComment}
                        onChange={(event) => setFeedbackComment(event.target.value)}
                        placeholder="记录业务专家反馈、遗漏事实或证据问题"
                      />
                      <div className="button-row">
                        <button className="secondary-button" onClick={() => saveFeedback(false)} disabled={loading}>保存反馈</button>
                        <button className="secondary-button" onClick={() => saveFeedback(true)} disabled={loading}>保存为评测</button>
                      </div>
                      {feedbackStatus && <span className="subtle-meta">{feedbackStatus}</span>}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <AlertTriangle size={20} />
                    <span>选择场景后运行 Agent</span>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === "eval" && (
            <>
              <div className="panel">
                <div className="panel-title">
                  <h2>评测中心</h2>
                  <Beaker size={18} />
                </div>
                {evalSuites.map((suite) => (
                  <div className="suite" key={suite.id}>
                    <strong>{suite.name}</strong>
                    <small>{suite.description}</small>
                    <span className="badge">{suite.priority} / {suite.case_count} cases</span>
                  </div>
                ))}
                <button className="secondary-button spaced" onClick={runEval} disabled={loading || !evalSuites.length}>
                  <CheckCircle2 size={18} />
                  运行 P0 回归
                </button>
              </div>

              <div className="panel wide">
                <div className="panel-title">
                  <h2>评测结果</h2>
                  <Beaker size={18} />
                </div>
                {evalRun ? (
                  <div className="eval-result">
                    <strong>{formatPercent(evalRun.pass_rate)} 通过</strong>
                    <span>{evalRun.passed}/{evalRun.total} cases / 样例评测</span>
                    {Object.entries(evalRun.boundary_summary).map(([key, value]) => (
                      <label key={key}>{key}<span>{value}</span></label>
                    ))}
                    {evalRun.cases.map((item) => (
                      <div className="rule" key={item.id}>
                        <span>{item.ontology_depth} / {item.name}</span>
                        <em className={badgeClass(item.mock_status)}>{item.mock_status}</em>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="empty-state">
                    <AlertTriangle size={20} />
                    <span>运行评测后查看结果</span>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === "simulation" && (
            <>
              <div className="panel">
                <div className="panel-title">
                  <h2>模拟推演</h2>
                  <SlidersHorizontal size={18} />
                </div>
                <div className="simulation-list">
                  {simTemplates.map((template) => (
                    <button className="simulation" key={template.id} onClick={() => runSimulation(template.id)}>
                      <span>
                        <strong>{template.name}</strong>
                        <small>{template.description}</small>
                      </span>
                      <em className={badgeClass(template.status)}>预研</em>
                    </button>
                  ))}
                </div>
              </div>

              <div className="panel wide">
                <div className="panel-title">
                  <h2>推演结果</h2>
                  <SlidersHorizontal size={18} />
                </div>
                {simulationRun ? (
                  <div className="run-detail">
                    <strong>{simulationRun.conclusion.summary}</strong>
                    <span className="subtle-meta">{simulationRun.conclusion.disclaimer}</span>
                    <div className="field-list">
                      {simulationRun.assumptions.map((item) => (
                        <label key={item.name}>
                          {item.name}
                          <span>{item.before_value} → {item.simulated_value}</span>
                        </label>
                      ))}
                    </div>
                    <div className="rule-list">
                      {simulationRun.diff.map((item) => (
                        <div className="rule" key={item.name}>
                          <span>{item.name}: {item.before} → {item.after}</span>
                          <em className={badgeClass(simulationRun.conclusion.risk_level_after)}>{item.impact}</em>
                        </div>
                      ))}
                    </div>
                    <div className="trace">
                      {simulationRun.impact_paths.map((item) => (
                        <span key={item.description}>{item.path.join(" → ")}：{item.description}</span>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="empty-state">
                    <AlertTriangle size={20} />
                    <span>选择一个模板运行推演</span>
                  </div>
                )}
              </div>
            </>
          )}

          {activeSection === "settings" && (
            <>
              <div className="panel">
                <div className="panel-title">
                  <h2>LLM 配置</h2>
                  <KeyRound size={18} />
                </div>
                <div className="settings-form">
                  <label>
                    Provider
                    <select
                      value={llmForm.provider}
                      onChange={(event) => setLlmForm((current) => ({ ...current, provider: event.target.value }))}
                    >
                      <option value="openai">OpenAI</option>
                      <option value="azure_openai">Azure OpenAI</option>
                      <option value="local">Local / Compatible</option>
                    </select>
                  </label>
                  <label>
                    Model
                    <input
                      value={llmForm.model}
                      onChange={(event) => setLlmForm((current) => ({ ...current, model: event.target.value }))}
                      placeholder="gpt-4.1-mini"
                    />
                  </label>
                  <label>
                    Base URL
                    <input
                      value={llmForm.base_url}
                      onChange={(event) => setLlmForm((current) => ({ ...current, base_url: event.target.value }))}
                      placeholder="https://api.openai.com/v1"
                    />
                  </label>
                  <label>
                    API Key
                    <input
                      type="password"
                      value={llmForm.api_key}
                      onChange={(event) => setLlmForm((current) => ({ ...current, api_key: event.target.value }))}
                      placeholder={llmSettings?.configured ? llmSettings.api_key_masked : "sk-..."}
                    />
                  </label>
                  <label>
                    Temperature
                    <input
                      type="number"
                      min="0"
                      max="2"
                      step="0.1"
                      value={llmForm.temperature}
                      onChange={(event) => setLlmForm((current) => ({ ...current, temperature: Number(event.target.value) }))}
                    />
                  </label>
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={llmForm.enabled}
                      onChange={(event) => setLlmForm((current) => ({ ...current, enabled: event.target.checked }))}
                    />
                    启用真实模型编排
                  </label>
                </div>
                <div className="button-row">
                  <button className="primary-button" onClick={saveLlmSettings} disabled={loading}>
                    <Save size={18} />
                    保存配置
                  </button>
                  <button className="secondary-button fit" onClick={testLlmSettings} disabled={loading}>
                    <CheckCircle2 size={18} />
                    测试配置
                  </button>
                </div>
                {llmTestMessage && <p className="context-line">{llmTestMessage}</p>}
              </div>

              <div className="panel wide">
                <div className="panel-title">
                  <h2>平台能力状态</h2>
                  <Settings size={18} />
                </div>
                <div className="settings-status">
                  <label>LLM Key<span>{llmSettings?.configured ? "已配置" : "未配置"}</span></label>
                  <label>当前模型<span>{llmSettings ? `${llmSettings.provider} / ${llmSettings.model}` : "--"}</span></label>
                  <label>后端<span>FastAPI / PostgreSQL</span></label>
                  <label>材料解析<span>LLM 生成，本地 fallback 保底</span></label>
                  <label>数据库<span>已接入项目、材料、本体、规则、评测</span></label>
                  <label>对象存储<span>接口预留</span></label>
                  <label>外部查询<span>离线样例</span></label>
                  <label>模拟推演<span>模板与运行接口已接入</span></label>
                </div>
                <div className="button-row">
                  <button className="secondary-button fit" onClick={initDatabase} disabled={loading}>
                    <RefreshCw size={18} />
                    初始化数据库
                  </button>
                  <button className="primary-button" onClick={ingestFinanceDemo} disabled={loading}>
                    <CloudUpload size={18} />
                    导入金融客户资料
                  </button>
                </div>
                {systemMessage && <p className="context-line">{systemMessage}</p>}
              </div>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
