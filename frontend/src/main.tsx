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
};

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

function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [scenarios, setScenarios] = useState<Scenario[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [evalSuites, setEvalSuites] = useState<EvalSuite[]>([]);
  const [simTemplates, setSimTemplates] = useState<SimulationTemplate[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("project_qsl_001");
  const [selectedScenarioId, setSelectedScenarioId] = useState("scenario.leasing_risk_review");
  const [agentRun, setAgentRun] = useState<AgentRun | null>(null);
  const [evalRun, setEvalRun] = useState<EvalRun | null>(null);
  const [loading, setLoading] = useState(false);

  const selectedProject = useMemo(
    () => projects.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  );

  const selectedScenario = useMemo(
    () => scenarios.find((scenario) => scenario.id === selectedScenarioId),
    [scenarios, selectedScenarioId]
  );

  useEffect(() => {
    async function load() {
      const [projectData, scenarioData, ruleData, suiteData, templateData] = await Promise.all([
        api<Project[]>("/api/projects"),
        api<Scenario[]>("/api/scenarios"),
        api<Rule[]>("/api/rules"),
        api<EvalSuite[]>("/api/eval/suites"),
        api<SimulationTemplate[]>("/api/simulations/templates")
      ]);
      setProjects(projectData);
      setScenarios(scenarioData);
      setRules(ruleData);
      setEvalSuites(suiteData);
      setSimTemplates(templateData);
    }
    load().catch(console.error);
  }, []);

  useEffect(() => {
    if (!selectedProjectId) return;
    api<DocumentItem[]>(`/api/projects/${selectedProjectId}/documents`).then(setDocuments).catch(console.error);
  }, [selectedProjectId]);

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
          <a className="active"><Layers3 size={18} />项目</a>
          <a><FileText size={18} />材料</a>
          <a><GitBranch size={18} />本体</a>
          <a><Bot size={18} />Agent</a>
          <a><Beaker size={18} />评测</a>
          <a><SlidersHorizontal size={18} />推演</a>
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

        <section className="content-grid">
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
                  <tr key={document.id}>
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
              <h2>场景与规则</h2>
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
            <div className="rule-list">
              {rules
                .filter((rule) => rule.scenario_id === selectedScenarioId)
                .map((rule) => (
                  <div className="rule" key={rule.id}>
                    <span>{rule.name}</span>
                    <em className={badgeClass(rule.mock_result)}>{rule.mock_result}</em>
                  </div>
                ))}
            </div>
          </div>

          <div className="panel">
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

          <div className="panel">
            <div className="panel-title">
              <h2>评测中心</h2>
              <Beaker size={18} />
            </div>
            <button className="secondary-button" onClick={runEval} disabled={loading || !evalSuites.length}>
              <CheckCircle2 size={18} />
              运行 P0 回归
            </button>
            {evalRun && (
              <div className="eval-result">
                <strong>{formatPercent(evalRun.pass_rate)} 通过</strong>
                <span>{evalRun.passed}/{evalRun.total} cases / 样例评测</span>
                {evalRun.cases.map((item) => (
                  <div className="rule" key={item.id}>
                    <span>{item.ontology_depth} / {item.name}</span>
                    <em className={badgeClass(item.mock_status)}>{item.mock_status}</em>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>模拟推演</h2>
              <SlidersHorizontal size={18} />
            </div>
            <div className="simulation-list">
              {simTemplates.map((template) => (
                <div className="simulation" key={template.id}>
                  <span>
                    <strong>{template.name}</strong>
                    <small>{template.description}</small>
                  </span>
                  <em className={badgeClass(template.status)}>开发中</em>
                </div>
              ))}
            </div>
          </div>
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
