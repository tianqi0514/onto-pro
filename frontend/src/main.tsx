import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity,
  AlertTriangle,
  Beaker,
  Bot,
  Brain,
  CheckCircle2,
  FileText,
  GitBranch,
  Layers3,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  SlidersHorizontal
} from "lucide-react";
import "./styles.css";

const API_BASE = "";
const sourceLabels: Record<string, string> = {
  local_file_mock: "本地文件",
  manual_annotation_mock: "人工标注",
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

type ActiveSection = "projects" | "documents" | "ontology" | "agent" | "eval" | "simulation";

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
  if (["active", "parsed", "passed", "completed", "hit"].includes(status)) return "badge good";
  if (["development", "needs_review", "manual_review"].includes(status)) return "badge warn";
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
  { id: "simulation", label: "推演", icon: SlidersHorizontal }
];

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [evalSuites, setEvalSuites] = useState<EvalSuite[]>([]);
  const [simTemplates, setSimTemplates] = useState<SimulationTemplate[]>([]);
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [relationTypes, setRelationTypes] = useState<RelationType[]>([]);
  const [activeSection, setActiveSection] = useState<ActiveSection>("projects");
  const [selectedProjectId, setSelectedProjectId] = useState("project_qsl_001");
  const [selectedScenarioId, setSelectedScenarioId] = useState("scenario.leasing_risk_review");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [evalRun, setEvalRun] = useState<EvalRun | null>(null);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [simulationRun, setSimulationRun] = useState<SimulationRun | null>(null);
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
      const [projectData, scenarioData, ruleData, suiteData, templateData, objectData, relationData] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<Scenario[]>("/api/scenarios"),
        api<Rule[]>("/api/rules"),
        api<EvalSuite[]>("/api/eval/suites"),
        api<SimulationTemplate[]>("/api/simulations/templates"),
        api<ObjectType[]>("/api/ontology/object-types"),
        api<RelationType[]>("/api/ontology/relation-types")
      ]);
      setProjects(projectData);
      setScenarios(scenarioData);
      setRules(ruleData);
      setEvalSuites(suiteData);
      setSimTemplates(templateData);
      setObjectTypes(objectData);
      setRelationTypes(relationData);
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
        <div className="mode-note">本地样例模式</div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <p>内部交付代管 / 本地文件优先</p>
            <h1>金融客户样板工作台</h1>
          </div>
          <div className="toolbar">
            <span className="mode-pill" title="当前数据来自本地样例和 mock API，正式数据库、对象存储和外部查询接口后续接入。">
              本地样例
            </span>
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
                    </div>
                  ))}
                </div>
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
