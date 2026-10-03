"use client";
import WalletPanel from "./wallet-panel";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  Layers,
  FolderKanban,
  UserRound,
  Plug,
  Plus,
  ArrowUpRight,
  Search,
  Check,
  Clock,
  FileText,
  Upload,
  ChevronRight,
  X,
  Menu,
  Activity,
  Database,
  CheckCircle2,
  AlertCircle,
  Copy,
  Download,
  MoreHorizontal,
  Archive,
  PenLine,
  RefreshCw,
  Wallet,
  BrainCircuit,
  Compass,
  ExternalLink,
} from "lucide-react";
import { budget, Row, WORK, NAPA, kinds } from "@/lib/domain";
type Data = Record<string, any>;
const labels: Record<string, string> = {
  knowledge: "Knowledge",
  decision: "Decisions",
  preference: "Preferences",
  constraint: "Constraints",
  working_style: "Working style",
  background: "Background",
  permission: "Permissions & spending rules",
  open_question: "Open questions",
};
const money = (c: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
  }).format(c / 100);
const time = (s: string) =>
  new Date(s).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
function Badge({
  children,
  tone = "neutral",
}: {
  children: React.ReactNode;
  tone?: string;
}) {
  return <span className={`badge ${tone}`}>{children}</span>;
}
function Empty({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="empty">
      <Layers size={25} />
      <strong>{title}</strong>
      {description && <p>{description}</p>}
    </div>
  );
}
function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: React.ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-head">
        <h2>{title}</h2>
        <button className="icon" onClick={onClose} aria-label="Close dialog">
          <X size={20} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export default function Home() {
  const [data, setData] = useState<Data | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [notice, setNotice] = useState("");
  const [page, setPage] = useState("projects"),
    [projectId, setProjectId] = useState(""),
    [tab, setTab] = useState("overview"),
    [menu, setMenu] = useState(false);
  const [modal, setModal] = useState<string | null>(null),
    [selected, setSelected] = useState<Row | null>(null),
    [detail, setDetail] = useState<any>(null),
    [result, setResult] = useState<any>(null);
  const [search, setSearch] = useState(""),
    [history, setHistory] = useState(false),
    [kindFilter, setKindFilter] = useState("all"),
    [agentFilter, setAgentFilter] = useState("all");
  const [taskQuery, setTaskQuery] = useState(
      "Create a six-slide executive deck from our research.",
    ),
    [pack, setPack] = useState<any>(null),
    [scope, setScope] = useState("current");
  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/action");
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setData(d);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    load();
    const p = new URLSearchParams(location.search);
    if (p.get("project")) {
      setProjectId(p.get("project")!);
      setPage("project");
      setTab(p.get("tab") || "overview");
    }
    if (p.get("wallet")) {
      setPage("connections");
      setNotice(
        p.get("wallet") === "connected"
          ? "Link wallet connected. Open a project budget to request a test purchase."
          : "Link connection was not completed. Check the OAuth configuration and try again.",
      );
    }
    if (p.get("checkout"))
      setNotice(
        "Returned from Checkout. Payment remains pending until the verified webhook arrives.",
      );
  }, [load]);
  useEffect(() => {
    if (page !== "project") return;
    const timer = setInterval(load, 7000);
    return () => clearInterval(timer);
  }, [page, load]);
  async function api(action: string, input: any = {}) {
    const r = await fetch("/api/action", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error);
    return d;
  }
  async function run(action: string, input: any = {}, done?: (r: any) => void) {
    setBusy(true);
    setError("");
    try {
      const r = await api(action, input);
      done?.(r);
      await load();
      return r;
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function navigate(next: string, id = "") {
    setPage(next);
    setProjectId(id);
    setTab("overview");
    setSearch("");
    setMenu(false);
    setPack(null);
    setHistory(false);
    setKindFilter("all");
    setAgentFilter("all");
    historyReplace(next, id);
  }
  function historyReplace(next: string, id: string) {
    window.history.replaceState(
      {},
      "",
      next === "project" ? `/?project=${id}` : "/",
    );
  }
  const projects: Row[] = data?.projects ?? [];
  const project = projects.find((p) => p.id === projectId);
  const scoped = (key: string): Row[] =>
    (data?.[key] ?? []).filter(
      (r: Row) => r.project_id === (page === "personal" ? null : projectId),
    );
  const contexts = scoped("context_items"),
    tasks = scoped("tasks"),
    artifacts = scoped("artifacts"),
    activities = scoped("activities"),
    transactions = scoped("transactions");
  const current = contexts.filter((r) => r.data.status === "active");
  const completed = tasks.filter((r) => r.data.status === "completed").length;
  const b =
    project?.data.budget_total_cents !== undefined
      ? budget(project, transactions)
      : null;
  const unavailable = !!data?.preview;
  function openModal(name: string, item: Row | null = null) {
    setSelected(item);
    setModal(name);
    setResult(null);
    setDetail(null);
  }
  function field(form: HTMLFormElement, name: string) {
    return String(new FormData(form).get(name) ?? "");
  }
  async function submitContext(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = e.currentTarget;
    const op = {
      op: selected ? "supersede_context" : "add_context",
      ...(selected ? { id: selected.id } : {}),
      kind: field(f, "kind"),
      content: field(f, "content"),
      confidence: 1,
    };
    await run(
      "write_update",
      {
        project_id: page === "personal" ? null : projectId,
        state_delta: [op],
        request_id: crypto.randomUUID(),
        expected_revision:
          page === "personal" ? data?.users[0].revision : project?.revision,
      },
      () => setModal(null),
    );
  }
  async function changeContext(r: Row, op: string) {
    await run("write_update", {
      project_id: r.project_id,
      state_delta: [{ op, id: r.id, confidence: 1 }],
      request_id: crypto.randomUUID(),
      expected_revision: r.project_id
        ? project?.revision
        : data?.users[0].revision,
    });
  }
  async function changeTask(r: Row, status: string) {
    await run("write_update", {
      project_id: projectId,
      state_delta: [{ op: "update_task", id: r.id, status, confidence: 1 }],
      request_id: crypto.randomUUID(),
      expected_revision: project?.revision,
    });
  }
  function contextCard(r: Row) {
    return (
      <article className="context-card" key={r.id}>
        <div className="row spread">
          <Badge
            tone={
              r.data.kind === "decision"
                ? "purple"
                : r.data.kind === "open_question"
                  ? "amber"
                  : "neutral"
            }
          >
            {labels[r.data.kind]}
          </Badge>
          {r.data.status !== "active" && <Badge>{r.data.status}</Badge>}
          <div className="actions">
            <button
              className="icon"
              title="Inspect source"
              aria-label="Inspect source"
              onClick={() => {
                setDetail(
                  (data?.sources ?? []).find(
                    (s: Row) => s.id === r.data.source_id,
                  ) ?? { message: "Source unavailable" },
                );
                setModal("source");
              }}
            >
              <Search size={15} />
            </button>
            {r.data.status === "active" && (
              <>
                <button
                  disabled={busy || unavailable}
                  className="icon"
                  title="Edit"
                  aria-label="Edit context"
                  onClick={() =>
                    openModal(
                      r.data.kind === "permission" ? "permission" : "context",
                      r,
                    )
                  }
                >
                  <PenLine size={15} />
                </button>
                <button
                  disabled={busy || unavailable || r.data.kind === "permission"}
                  className="icon"
                  title="Mark outdated"
                  aria-label="Mark outdated"
                  onClick={() => changeContext(r, "archive_context")}
                >
                  <Archive size={15} />
                </button>
                {r.data.kind === "open_question" && (
                  <button
                    className="icon"
                    title="Resolve question"
                    aria-label="Resolve question"
                    disabled={busy || unavailable}
                    onClick={() => changeContext(r, "resolve_question")}
                  >
                    <Check size={16} />
                  </button>
                )}
              </>
            )}
          </div>
        </div>
        <p>{r.data.content}</p>
        <div className="metadata">
          <span className="avatar tiny">{(r.data.source_agent ?? "S")[0]}</span>
          {r.data.source_agent ?? "Seed"}
          <span>·</span>
          {time(r.updated_at)}
          <span>·</span>
          {Math.round((r.data.confidence ?? 1) * 100)}% confidence
        </div>
      </article>
    );
  }
  function taskList(list: Row[]) {
    return list.length ? (
      <div className="task-list">
        {list.map((t) => (
          <div className="task-row" key={t.id}>
            <button
              className={`task-check ${t.data.status === "completed" ? "checked" : ""}`}
              disabled={busy || unavailable}
              aria-label={`Mark ${t.data.title} ${t.data.status === "completed" ? "pending" : "complete"}`}
              onClick={() =>
                changeTask(
                  t,
                  t.data.status === "completed" ? "pending" : "completed",
                )
              }
            >
              {t.data.status === "completed" && <Check size={13} />}
            </button>
            <div className="grow">
              <strong>{t.data.title}</strong>
              {t.data.description && (
                <p className="secondary">{t.data.description}</p>
              )}
              <span className="metadata">
                {t.data.completed_by ?? t.data.created_by}
                {t.data.completed_at ? ` · ${time(t.data.completed_at)}` : ""}
              </span>
            </div>
            <select
              aria-label={`${t.data.title} status`}
              value={t.data.status}
              disabled={busy || unavailable}
              onChange={(e) => changeTask(t, e.target.value)}
            >
              <option value="pending">Pending</option>
              <option value="in_progress">In progress</option>
              <option value="completed">Completed</option>
            </select>
            <button
              className="icon"
              aria-label={`Edit ${t.data.title}`}
              disabled={busy || unavailable}
              onClick={() => openModal("task", t)}
            >
              <PenLine size={15} />
            </button>
          </div>
        ))}
      </div>
    ) : (
      <Empty title="No tasks here" />
    );
  }
  function timeline(list: Row[]) {
    return list.length ? (
      <div className="timeline">
        {list.map((a) => (
          <div className="timeline-row" key={a.id}>
            <div
              className={`timeline-icon ${a.data.action_type === "error" ? "error-icon" : ""}`}
            >
              <Activity size={15} />
            </div>
            <div>
              <p>{a.data.description}</p>
              <span className="metadata">
                {a.data.actor} · {time(a.created_at)}
              </span>
              {a.data.error && <p className="error-text">{a.data.error}</p>}
              {a.data.artifact_id && (
                <button
                  className="text-button"
                  onClick={() => {
                    setTab("artifacts");
                  }}
                >
                  View artifact
                </button>
              )}
              {a.data.transaction_id && (
                <button
                  className="text-button"
                  onClick={() => setTab("budget")}
                >
                  View payment
                </button>
              )}
              {a.data.source_id && (
                <button
                  className="text-button"
                  onClick={() => {
                    setDetail(
                      (data?.sources ?? []).find(
                        (s: Row) => s.id === a.data.source_id,
                      ),
                    );
                    setModal("source");
                  }}
                >
                  View source
                </button>
              )}
            </div>
          </div>
        ))}
      </div>
    ) : (
      <Empty
        title="No activity yet"
        description="Accepted changes from your agents will appear here."
      />
    );
  }
  function budgetCards() {
    return (
      b && (
        <div className="metrics">
          {[
            ["Total budget", b.total_cents],
            ["Spent", b.spent_cents],
            ["Pending reservations", b.reserved_cents],
            ["Available to spend", b.available_cents],
          ].map(([label, amount], i) => (
            <div className={`metric ${i === 3 ? "accent" : ""}`} key={label}>
              <span>{label}</span>
              <strong>{money(amount as number)}</strong>
              {i === 3 && (
                <small>
                  {money(b.remaining_cents)} remaining before reservations
                </small>
              )}
            </div>
          ))}
        </div>
      )
    );
  }
  if (!data)
    return (
      <main className="loading">
        <Layers size={36} />
        <h2>Opening your workspace</h2>
        {error ? (
          <>
            <p role="alert">{error}</p>
            <button onClick={load}>Retry</button>
          </>
        ) : (
          <p>Loading shared project state…</p>
        )}
      </main>
    );
  return (
    <div className="shell">
      <aside className={menu ? "sidebar open" : "sidebar"}>
        <a
          className="brand"
          href="/"
          onClick={(e) => {
            e.preventDefault();
            navigate("projects");
          }}
        >
          <span className="brand-mark">
            <Layers size={23} />
          </span>
          shared<span className="brand-light">state</span>
        </a>
        <div className="workspace-label">CONTEXT CONTROL CENTER</div>
        <nav>
          <button
            className={page === "personal" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("personal")}
          >
            <UserRound size={18} />
            Personal context
          </button>
          <button
            className={page === "projects" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("projects")}
          >
            <FolderKanban size={18} />
            Projects<span className="nav-count">{projects.length}</span>
          </button>
          <div className="project-links">
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => navigate("project", p.id)}
                className={
                  projectId === p.id ? "project-link selected" : "project-link"
                }
              >
                <span className={`project-dot ${p.data.type}`} />
                {p.data.name}
              </button>
            ))}
          </div>
          <button
            className={page === "connections" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("connections")}
          >
            <Plug size={18} />
            Connections
          </button>
        </nav>
        <div className="sidebar-bottom">
          <div className="synthetic">
            <span className="demo-dot" />
            <div>
              <strong>Synthetic demo</strong>
              <small>Stripe test mode only</small>
            </div>
          </div>
          <div className="profile">
            <span className="avatar">D</span>
            <div>
              <strong>Demo workspace</strong>
              <small>Shared across your agents</small>
            </div>
          </div>
        </div>
      </aside>
      {menu && (
        <button
          className="scrim"
          onClick={() => setMenu(false)}
          aria-label="Close navigation"
        />
      )}
      <div className="main">
        <div className="topbar">
          <button
            className="icon mobile-menu"
            aria-label="Open navigation"
            onClick={() => setMenu(!menu)}
          >
            <Menu size={21} />
          </button>
          <div className="breadcrumb">
            Workspace <ChevronRight size={14} />
            <span>
              {page === "project"
                ? project?.data.name
                : page === "personal"
                  ? "Personal context"
                  : page === "connections"
                    ? "Connections"
                    : "Projects"}
            </span>
          </div>
          <div className="row">
            <Badge tone="purple">Public demo</Badge>
            <button className="icon" aria-label="Refresh state" onClick={load}>
              <RefreshCw size={16} />
            </button>
          </div>
        </div>
        <main className="content">
          {unavailable && (
            <div className="banner">
              <Database size={18} />
              <div>
                <strong>Setup preview</strong> · Seed data only. Connect your
                database to enable saved changes and live agent tools.
              </div>
              <button
                className="text-button"
                onClick={() => navigate("connections")}
              >
                View setup
              </button>
            </div>
          )}
          {error && (
            <div className="banner error" role="alert">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                className="icon"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {notice && (
            <div className="banner" role="status">
              {notice}
              <button
                className="icon"
                aria-label="Dismiss notification"
                onClick={() => setNotice("")}
              >
                <X size={17} />
              </button>
            </div>
          )}
          {page === "projects" && (
            <>
              <header className="page-header">
                <div>
                  <div className="eyebrow">YOUR SHARED WORKSPACE</div>
                  <h1>Projects</h1>
                  <p>Work moves between agents. Context stays here.</p>
                </div>
                <button
                  className="primary"
                  disabled={unavailable}
                  onClick={() => openModal("project")}
                >
                  <Plus size={17} />
                  New project
                </button>
              </header>
              <div className="summary-strip">
                <div>
                  <strong>{projects.length}</strong>
                  <span>Projects</span>
                </div>
                <div>
                  <strong>
                    {
                      data.context_items.filter(
                        (r: Row) => r.data.status === "active",
                      ).length
                    }
                  </strong>
                  <span>Context items</span>
                </div>
                <div>
                  <strong>
                    {
                      data.tasks.filter(
                        (r: Row) => r.data.status === "completed",
                      ).length
                    }
                  </strong>
                  <span>Tasks completed</span>
                </div>
                <div>
                  <strong>
                    {
                      data.artifacts.filter(
                        (r: Row) => r.data.status === "active",
                      ).length
                    }
                  </strong>
                  <span>Artifacts</span>
                </div>
              </div>
              <div className="row spread section-heading">
                <h2>All projects</h2>
                <span className="secondary">
                  One source of truth for every agent
                </span>
              </div>
              <div className="project-grid">
                {projects.map((p) => {
                  const ts: Row[] = data.tasks.filter(
                    (t: Row) => t.project_id === p.id,
                  );
                  const done = ts.filter(
                    (t) => t.data.status === "completed",
                  ).length;
                  const acts: Row[] = data.activities.filter(
                    (t: Row) => t.project_id === p.id,
                  );
                  const pb =
                    p.data.budget_total_cents !== undefined
                      ? budget(
                          p,
                          data.transactions.filter(
                            (t: Row) => t.project_id === p.id,
                          ),
                        )
                      : null;
                  return (
                    <button
                      className="project-card"
                      key={p.id}
                      onClick={() => navigate("project", p.id)}
                    >
                      <div className="row spread">
                        <span className={`project-symbol ${p.data.type}`}>
                          {p.data.type === "work" ? (
                            <BrainCircuit size={25} />
                          ) : (
                            <Compass size={25} />
                          )}
                        </span>
                        <Badge tone="green">{p.data.status}</Badge>
                      </div>
                      <h2>{p.data.name}</h2>
                      <p>{p.data.goal}</p>
                      <div className="project-progress">
                        <div className="row spread">
                          <span>Task progress</span>
                          <strong>
                            {done} / {ts.length}
                          </strong>
                        </div>
                        <div className="progress">
                          <span
                            style={{
                              width: `${ts.length ? (done / ts.length) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                      <div className="project-foot">
                        <span>
                          {pb
                            ? `${money(pb.available_cents)} available`
                            : acts[0]
                              ? time(acts[0].created_at)
                              : "No activity yet"}
                        </span>
                        <ArrowUpRight size={19} />
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="lower-grid">
                <section className="panel">
                  <div className="panel-head">
                    <h2>Recent activity</h2>
                    <Activity size={18} />
                  </div>
                  {timeline(data.activities.slice(0, 5))}
                </section>
                <section className="handoff-panel">
                  <span className="eyebrow">THE AGENT HANDOFF</span>
                  <h2>
                    Pick up where
                    <br />
                    the last agent left off.
                  </h2>
                  <div className="handoff-flow">
                    <span>Read state</span>
                    <ChevronRight size={16} />
                    <span>Do work</span>
                    <ChevronRight size={16} />
                    <span>Write changes</span>
                  </div>
                  <p>
                    Connect ChatGPT and Claude to the same projects, decisions,
                    and artifacts.
                  </p>
                  <button onClick={() => navigate("connections")}>
                    Connect your agents <Plug size={16} />
                  </button>
                </section>
              </div>
            </>
          )}
          {page === "personal" && (
            <>
              <header className="page-header">
                <div>
                  <div className="eyebrow">CROSS-PROJECT CONTEXT</div>
                  <h1>Personal context</h1>
                  <p>How your agents should work with you.</p>
                </div>
                <button
                  className="primary"
                  disabled={unavailable}
                  onClick={() => openModal("context")}
                >
                  <Plus size={17} />
                  Add context
                </button>
              </header>
              <div className="toolbar">
                <label className="check-label">
                  <input
                    type="checkbox"
                    checked={history}
                    onChange={(e) => setHistory(e.target.checked)}
                  />
                  Show history
                </label>
                <button
                  disabled={unavailable}
                  onClick={() => openModal("permission")}
                >
                  <Wallet size={16} />
                  Spending rules
                </button>
              </div>
              {[
                "preference",
                "constraint",
                "background",
                "working_style",
                "permission",
              ].map((k) => (
                <section key={k} className="context-group">
                  <h2>{labels[k]}</h2>
                  {contexts.filter(
                    (r) =>
                      r.data.kind === k &&
                      (history || r.data.status === "active"),
                  ).length ? (
                    <div className="context-grid">
                      {contexts
                        .filter(
                          (r) =>
                            r.data.kind === k &&
                            (history || r.data.status === "active"),
                        )
                        .map(contextCard)}
                    </div>
                  ) : (
                    <Empty title={`No ${labels[k].toLowerCase()} yet`} />
                  )}
                </section>
              ))}
            </>
          )}
          {page === "project" && project && (
            <>
              <header className="page-header">
                <div>
                  <div className="eyebrow">
                    {project.data.type === "work"
                      ? "KNOWLEDGE / WORK PROJECT"
                      : "PERSONAL ERRAND PROJECT"}
                  </div>
                  <h1>{project.data.name}</h1>
                  <p>{project.data.goal}</p>
                  <div className="metadata">
                    <Badge tone="green">{project.data.status}</Badge>Updated{" "}
                    {time(project.updated_at)} · Revision {project.revision}
                  </div>
                </div>
                <div className="row">
                  <button
                    disabled={unavailable}
                    onClick={() => openModal("upload")}
                  >
                    <Upload size={16} />
                    Upload artifact
                  </button>
                  <button
                    className="primary"
                    disabled={unavailable}
                    onClick={() => openModal("update")}
                  >
                    <Plus size={17} />
                    Add update
                  </button>
                </div>
              </header>
              <div className="tabs">
                {[
                  "overview",
                  "context",
                  "tasks",
                  "artifacts",
                  "activity",
                  "inspector",
                  ...(b ? ["budget"] : []),
                ].map((t) => (
                  <button
                    key={t}
                    className={tab === t ? "active" : ""}
                    onClick={() => {
                      setTab(t);
                      setSearch("");
                    }}
                  >
                    {t[0].toUpperCase() + t.slice(1)}
                    {t === "tasks" && <span>{tasks.length}</span>}
                    {t === "artifacts" && (
                      <span>
                        {
                          artifacts.filter((r) => r.data.status === "active")
                            .length
                        }
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {tab === "overview" && (
                <>
                  {b ? (
                    budgetCards()
                  ) : (
                    <div className="metrics">
                      {[
                        ["Context items", current.length],
                        [
                          "Decisions",
                          current.filter((r) => r.data.kind === "decision")
                            .length,
                        ],
                        ["Tasks completed", `${completed} / ${tasks.length}`],
                        [
                          "Artifacts",
                          artifacts.filter((r) => r.data.status === "active")
                            .length,
                        ],
                      ].map(([label, value]) => (
                        <div className="metric" key={label}>
                          <span>{label}</span>
                          <strong>{value}</strong>
                        </div>
                      ))}
                    </div>
                  )}
                  <div className="lower-grid">
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Next steps</h2>
                        <button
                          className="text-button"
                          onClick={() => setTab("tasks")}
                        >
                          All tasks
                        </button>
                      </div>
                      {taskList(
                        tasks.filter((r) => r.data.status !== "completed"),
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Decisions & constraints</h2>
                        <Layers size={18} />
                      </div>
                      {current.filter((r) =>
                        ["decision", "constraint", "preference"].includes(
                          r.data.kind,
                        ),
                      ).length ? (
                        current
                          .filter((r) =>
                            ["decision", "constraint", "preference"].includes(
                              r.data.kind,
                            ),
                          )
                          .slice(0, 5)
                          .map(contextCard)
                      ) : (
                        <Empty
                          title="No decisions yet"
                          description="Accepted agent decisions will appear here."
                        />
                      )}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Recent activity</h2>
                      </div>
                      {timeline(activities.slice(0, 5))}
                    </section>
                    <section className="panel">
                      <div className="panel-head">
                        <h2>Open questions</h2>
                      </div>
                      {current.filter((r) => r.data.kind === "open_question")
                        .length ? (
                        current
                          .filter((r) => r.data.kind === "open_question")
                          .map(contextCard)
                      ) : (
                        <Empty
                          title="No open questions"
                          description="Unresolved issues stay visible across agent handoffs."
                        />
                      )}
                      <div className="panel-head">
                        <h2>Canonical artifacts</h2>
                      </div>
                      {artifacts
                        .filter(
                          (r) =>
                            r.data.is_canonical && r.data.status === "active",
                        )
                        .map((r) => (
                          <button
                            key={r.id}
                            className="artifact-link"
                            onClick={() => setTab("artifacts")}
                          >
                            <FileText size={17} />
                            {r.data.name}
                          </button>
                        ))}
                      {!artifacts.some(
                        (r) =>
                          r.data.is_canonical && r.data.status === "active",
                      ) && (
                        <p className="secondary padded">
                          No canonical artifacts yet.
                        </p>
                      )}
                    </section>
                  </div>
                </>
              )}
              {tab === "context" && (
                <>
                  <div className="toolbar">
                    <div className="row wrap">
                      <select
                        aria-label="Context kind"
                        value={kindFilter}
                        onChange={(e) => setKindFilter(e.target.value)}
                      >
                        <option value="all">All types</option>
                        {kinds.map((k) => (
                          <option key={k} value={k}>
                            {labels[k]}
                          </option>
                        ))}
                      </select>
                      <select
                        aria-label="Source agent"
                        value={agentFilter}
                        onChange={(e) => setAgentFilter(e.target.value)}
                      >
                        <option value="all">All agents</option>
                        {[
                          ...new Set(contexts.map((r) => r.data.source_agent)),
                        ].map((a) => (
                          <option key={a}>{a}</option>
                        ))}
                      </select>
                      <label className="check-label">
                        <input
                          type="checkbox"
                          checked={history}
                          onChange={(e) => setHistory(e.target.checked)}
                        />
                        Show history
                      </label>
                    </div>
                    <div className="row">
                      <button
                        disabled={busy || unavailable}
                        onClick={() =>
                          run(
                            "retry_indexing",
                            { project_id: projectId },
                            (r) =>
                              setNotice(
                                `${r.indexed} indexed; ${r.pending} pending.`,
                              ),
                          )
                        }
                      >
                        <RefreshCw size={15} />
                        Retry indexing
                      </button>
                      <button
                        disabled={unavailable}
                        onClick={() => openModal("context")}
                      >
                        <Plus size={16} />
                        Add context
                      </button>
                    </div>
                  </div>
                  <div className="context-grid">
                    {contexts
                      .filter(
                        (r) =>
                          (history || r.data.status === "active") &&
                          (kindFilter === "all" ||
                            r.data.kind === kindFilter) &&
                          (agentFilter === "all" ||
                            r.data.source_agent === agentFilter),
                      )
                      .map(contextCard)}
                  </div>
                  {!contexts.length && (
                    <Empty
                      title="Your shared context starts here"
                      description="Add an update or connect an agent to capture findings and decisions."
                    />
                  )}
                  {scoped("ingestion_runs")
                    .filter(
                      (r) =>
                        r.data.stage === "needs_review" &&
                        r.data.result?.review?.length,
                    )
                    .map((r) => (
                      <section className="panel review" key={r.id}>
                        <h2>Needs review</h2>
                        {r.data.result.review.map(
                          (o: any, i: number) =>
                            !r.data.review_resolutions?.[i] && (
                              <div key={i}>
                                <p>{o.content}</p>
                                <p className="secondary">{o.conflict_reason}</p>
                                <button
                                  onClick={() => {
                                    setSelected(r);
                                    setDetail({ ...o, review_index: i });
                                    setModal("review");
                                  }}
                                >
                                  Review proposal
                                </button>
                              </div>
                            ),
                        )}
                      </section>
                    ))}
                </>
              )}
              {tab === "tasks" && (
                <>
                  <div className="toolbar">
                    <span className="secondary">
                      {completed} of {tasks.length} completed
                    </span>
                    <button
                      disabled={unavailable}
                      onClick={() => openModal("task")}
                    >
                      <Plus size={16} />
                      New task
                    </button>
                  </div>
                  {["in_progress", "pending", "completed"].map((s) => (
                    <section className="panel task-section" key={s}>
                      <div className="panel-head">
                        <h2>{s.replace("_", " ")}</h2>
                        <Badge>
                          {tasks.filter((t) => t.data.status === s).length}
                        </Badge>
                      </div>
                      {taskList(tasks.filter((t) => t.data.status === s))}
                    </section>
                  ))}
                </>
              )}
              {tab === "artifacts" && (
                <>
                  <div className="toolbar">
                    <label className="search-box">
                      <Search size={17} />
                      <input
                        placeholder="Search artifacts"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    <label className="check-label">
                      <input
                        type="checkbox"
                        checked={history}
                        onChange={(e) => setHistory(e.target.checked)}
                      />
                      Show archived
                    </label>
                    <button
                      disabled={unavailable}
                      onClick={() => openModal("text-artifact")}
                    >
                      <Plus size={16} />
                      Save text
                    </button>
                  </div>
                  <div className="artifact-grid">
                    {artifacts
                      .filter(
                        (a) =>
                          (history || a.data.status === "active") &&
                          `${a.data.name} ${a.data.summary}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                      )
                      .map((a) => (
                        <article className="artifact-card" key={a.id}>
                          <div className="row spread">
                            <span className="file-icon">
                              <FileText size={25} />
                            </span>
                            {a.data.is_canonical && (
                              <Badge tone="purple">Canonical</Badge>
                            )}
                            <Badge>{a.data.status}</Badge>
                          </div>
                          <h3>{a.data.name}</h3>
                          <p>
                            {a.data.summary ||
                              "Waiting for content extraction."}
                          </p>
                          <div className="metadata">
                            v{a.data.version} · {a.data.created_by_agent} ·{" "}
                            {time(a.created_at)}
                          </div>
                          <div className="row wrap">
                            <Badge
                              tone={
                                a.data.processing_status === "failed"
                                  ? "red"
                                  : a.data.processing_status === "complete"
                                    ? "green"
                                    : "neutral"
                              }
                            >
                              {a.data.processing_status.replaceAll("_", " ")}
                            </Badge>
                          </div>
                          {a.data.processing_error && (
                            <p className="error-text">
                              {a.data.processing_error}
                            </p>
                          )}
                          <div className="artifact-actions">
                            <button
                              disabled={busy || unavailable}
                              onClick={() =>
                                run("artifact_detail", { id: a.id }, (r) => {
                                  setDetail(r);
                                  setModal("artifact-detail");
                                })
                              }
                            >
                              Inspect
                            </button>
                            {a.data.status === "active" && (
                              <>
                                <button
                                  disabled={busy || unavailable}
                                  title="Mark canonical"
                                  aria-label="Mark canonical"
                                  onClick={() => run("canonical", { id: a.id })}
                                >
                                  <CheckCircle2 size={16} />
                                </button>
                                <button
                                  disabled={busy || unavailable}
                                  title="Archive"
                                  aria-label="Archive artifact"
                                  onClick={() =>
                                    run("archive_artifact", { id: a.id })
                                  }
                                >
                                  <Archive size={16} />
                                </button>
                                {[
                                  "failed",
                                  "indexing_failed",
                                  "awaiting_upload",
                                  "stored",
                                ].includes(a.data.processing_status) && (
                                  <button
                                    disabled={busy || unavailable}
                                    title="Retry processing"
                                    aria-label="Retry processing"
                                    onClick={() =>
                                      run("process_artifact", { id: a.id })
                                    }
                                  >
                                    <RefreshCw size={16} />
                                  </button>
                                )}
                              </>
                            )}
                          </div>
                        </article>
                      ))}
                  </div>
                  {!artifacts.length && (
                    <Empty
                      title="Keep the original. Share the context."
                      description="Upload research, confirmations, or screenshots. Save agent-generated memos as text."
                    />
                  )}
                </>
              )}
              {tab === "activity" && (
                <section className="panel">{timeline(activities)}</section>
              )}
              {tab === "inspector" && (
                <>
                  <section className="panel inspector-form">
                    <div className="eyebrow">SEE WHAT YOUR AGENT SEES</div>
                    <h2>Context Inspector</h2>
                    <p className="secondary">
                      Compile just the state needed for a specific task.
                    </p>
                    <label>
                      Task
                      <textarea
                        value={taskQuery}
                        onChange={(e) => setTaskQuery(e.target.value)}
                        rows={3}
                      />
                    </label>
                    <div className="row spread">
                      <select
                        aria-label="Context scope"
                        value={scope}
                        onChange={(e) => setScope(e.target.value)}
                      >
                        <option value="current">{project.data.name}</option>
                        <option value="personal">Personal context only</option>
                      </select>
                      <button
                        className="primary"
                        disabled={busy || unavailable || !taskQuery.trim()}
                        onClick={() =>
                          run(
                            "get_context",
                            {
                              task: taskQuery,
                              ...(scope === "current"
                                ? { project_id: projectId }
                                : {}),
                            },
                            setPack,
                          )
                        }
                      >
                        <Layers size={16} />
                        {busy ? "Compiling…" : "Generate context"}
                      </button>
                    </div>
                  </section>
                  {pack && (
                    <section className="panel pack">
                      <div className="panel-head">
                        <h2>Returned context</h2>
                        <Badge
                          tone={
                            pack.meta.retrieval_mode === "compiled"
                              ? "purple"
                              : "amber"
                          }
                        >
                          {pack.meta.retrieval_mode.replace("_", " ")}
                        </Badge>
                      </div>
                      <div className="padded">
                        <p className="metadata">
                          {time(pack.meta.generated_at)} · Revision{" "}
                          {pack.project?.revision ?? "personal"}
                        </p>
                        {pack.meta.warnings.map((w: string, i: number) => (
                          <p key={i} className="warning-text">
                            {w}
                          </p>
                        ))}
                        {[
                          "personal_context",
                          "constraints",
                          "permissions",
                          "knowledge",
                          "decisions",
                          "open_questions",
                        ].map((k) =>
                          pack[k]?.length ? (
                            <div key={k}>
                              <h3>{k.replaceAll("_", " ")}</h3>
                              {pack[k].map((r: any) => (
                                <div className="pack-item" key={r.id}>
                                  <p>{r.content}</p>
                                  <small>Source {r.source_id}</small>
                                </div>
                              ))}
                            </div>
                          ) : null,
                        )}
                        {pack.tasks?.length > 0 && (
                          <>
                            <h3>Tasks</h3>
                            {pack.tasks.map((t: any) => (
                              <p key={t.id}>
                                {t.title} · {t.status}
                              </p>
                            ))}
                          </>
                        )}
                        {pack.budget && (
                          <p>
                            Available budget:{" "}
                            <strong>
                              {money(pack.budget.available_cents)}
                            </strong>
                          </p>
                        )}
                        {pack.artifacts?.map((a: any) => (
                          <div key={a.id}>
                            <h3>{a.name}</h3>
                            <p>{a.summary}</p>
                            {a.excerpts.map((x: any) => (
                              <p key={x.id}>
                                {x.locator}: {x.text}
                              </p>
                            ))}
                          </div>
                        ))}
                        <details>
                          <summary>Raw JSON</summary>
                          <pre>{JSON.stringify(pack, null, 2)}</pre>
                        </details>
                      </div>
                    </section>
                  )}
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Recent retrievals</h2>
                    </div>
                    {scoped("context_retrievals")
                      .slice(0, 10)
                      .map((r) => (
                        <button
                          className="retrieval-row"
                          key={r.id}
                          onClick={() => setPack(r.data.pack)}
                        >
                          <span>{r.data.task}</span>
                          <small>
                            {r.data.actor} · {time(r.created_at)}
                          </small>
                          <ChevronRight size={16} />
                        </button>
                      ))}
                    {!scoped("context_retrievals").length && (
                      <Empty title="No context packs generated yet" />
                    )}
                  </section>
                </>
              )}
              {tab === "budget" && b && (
                <>
                  <WalletPanel
                    projectId={projectId}
                    transactions={transactions}
                    onChange={load}
                  />
                  {budgetCards()}
                  <div className="budget-rule">
                    <Wallet size={20} />
                    <div>
                      <strong>Human review before every checkout</strong>
                      <p>
                        Payments above {money(b.approval_threshold_cents)}{" "}
                        require explicit approval. All bookings are simulated.
                      </p>
                    </div>
                    <button
                      className="primary"
                      disabled={unavailable}
                      onClick={() => openModal("payment")}
                    >
                      <Plus size={16} />
                      Request payment
                    </button>
                  </div>
                  <section className="panel">
                    <div className="panel-head">
                      <h2>Transactions</h2>
                      <Badge>USD · Test mode</Badge>
                    </div>
                    {transactions.length ? (
                      <div className="table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th>Description</th>
                              <th>Category</th>
                              <th>Amount</th>
                              <th>Status</th>
                              <th>Action</th>
                            </tr>
                          </thead>
                          <tbody>
                            {transactions.map((t) => (
                              <tr key={t.id}>
                                <td>
                                  <strong>{t.data.description}</strong>
                                  <small>{time(t.created_at)}</small>
                                </td>
                                <td>{t.data.category}</td>
                                <td>{money(t.data.amount_cents)}</td>
                                <td>
                                  <Badge
                                    tone={
                                      t.data.status === "succeeded"
                                        ? "green"
                                        : "amber"
                                    }
                                  >
                                    {t.data.status}
                                  </Badge>
                                </td>
                                <td>
                                  {["requested", "checkout"].includes(
                                    t.data.status,
                                  ) && (
                                    <button
                                      disabled={busy || unavailable}
                                      onClick={() =>
                                        openModal("review-payment", t)
                                      }
                                    >
                                      Review
                                    </button>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <Empty
                        title="No payments yet"
                        description="Start with a $410 hotel request, then a $62 winery request."
                      />
                    )}
                  </section>
                </>
              )}
            </>
          )}
          {page === "connections" && (
            <>
              <header className="page-header">
                <div>
                  <div className="eyebrow">READ · ACT · WRITE BACK</div>
                  <h1>Connect your agents</h1>
                  <p>Give ChatGPT and Claude the same starting point.</p>
                </div>
                <Plug size={32} />
              </header>
              <WalletPanel onChange={load} />
              <section className="panel connection-url">
                <h2>Shared MCP endpoint</h2>
                <div className="copy-field">
                  <code>
                    {typeof location !== "undefined" ? location.origin : ""}/mcp
                  </code>
                  <button
                    aria-label="Copy MCP URL"
                    onClick={() => {
                      navigator.clipboard.writeText(`${location.origin}/mcp`);
                      setNotice("MCP URL copied.");
                    }}
                  >
                    <Copy size={16} />
                  </button>
                </div>
                <p className="secondary">
                  Public synthetic workspace · Streamable HTTP · No
                  authentication for shared context. Wallet tools require an
                  operator bearer token.
                </p>
              </section>
              <div className="two-col">
                {["ChatGPT", "Claude"].map((agent) => (
                  <section className="panel connection-card" key={agent}>
                    <div className="row spread">
                      <span className={`agent-logo ${agent.toLowerCase()}`}>
                        {agent === "ChatGPT" ? (
                          <BrainCircuit size={25} />
                        ) : (
                          <span>✳</span>
                        )}
                      </span>
                      <Badge>
                        {data.activities.some(
                          (r: Row) =>
                            r.data.action_type === "tool_call" &&
                            String(r.data.actor)
                              .toLowerCase()
                              .includes(agent.toLowerCase()),
                        )
                          ? "Tool call observed"
                          : "Not verified"}
                      </Badge>
                    </div>
                    <h2>{agent}</h2>
                    <ol>
                      {(agent === "ChatGPT"
                        ? [
                            "Enable developer mode in your ChatGPT settings.",
                            "Add a custom MCP connection using the public HTTPS endpoint above.",
                            "Select the connection in a new conversation.",
                          ]
                        : [
                            "Open Settings / Customize → Connectors.",
                            "Add a custom remote MCP connector with the endpoint above.",
                            "Enable the connector in your conversation.",
                          ]
                      ).map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ol>
                    <p className="metadata">
                      {data.activities.find(
                        (r: Row) =>
                          r.data.action_type === "tool_call" &&
                          String(r.data.actor)
                            .toLowerCase()
                            .includes(agent.toLowerCase()),
                      )
                        ? `Last observed: ${time(data.activities.find((r: Row) => r.data.action_type === "tool_call" && String(r.data.actor).toLowerCase().includes(agent.toLowerCase())).created_at)}`
                        : "No successful client call recorded."}
                    </p>
                  </section>
                ))}
              </div>
              <section className="panel">
                <div className="panel-head">
                  <h2>Provider configuration</h2>
                </div>
                <div className="provider-grid">
                  {Object.entries(data.providers).map(([name, ready]) => (
                    <div key={name}>
                      <span>{name}</span>
                      <Badge tone={ready ? "green" : "amber"}>
                        {ready ? "Configured" : "Missing"}
                      </Badge>
                    </div>
                  ))}
                </div>
                <p className="secondary padded">
                  Configuration presence does not prove connectivity. Use the
                  setup guide to apply the database migration and validate each
                  provider.
                </p>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Try a handoff</h2>
                </div>
                <div className="padded">
                  {[
                    [
                      "Research → memo",
                      "Find the AI Agent Market Research project with list_projects, then call get_context before acting. Create an investment memo using existing research. After completing meaningful work, call commit_work exactly once with your final output and market-memo.md as the deliverable. Do not write back casual discussion or reasoning traces.",
                    ],
                    [
                      "Napa weekend",
                      "Find Napa Weekend with list_projects, then call get_context before acting. Respect its preferences, constraints, and budget. Propose a $410 hotel test payment using request_payment and give me the review link. If you produce durable planning work, call commit_work exactly once with the final output. Do not claim a booking happened until payment is confirmed.",
                    ],
                  ].map(([name, prompt]) => (
                    <div className="prompt-card" key={name}>
                      <div className="row spread">
                        <h3>{name}</h3>
                        <button
                          className="icon"
                          aria-label={`Copy ${name} prompt`}
                          onClick={() => {
                            navigator.clipboard.writeText(prompt);
                            setNotice("Prompt copied.");
                          }}
                        >
                          <Copy size={16} />
                        </button>
                      </div>
                      <p>{prompt}</p>
                    </div>
                  ))}
                </div>
              </section>
              <section className="panel">
                <div className="panel-head">
                  <h2>Available tools</h2>
                </div>
                <div className="tools">
                  {[
                    "list_projects",
                    "get_project_state",
                    "get_context",
                    "commit_work (recommended)",
                    "ingest_output",
                    "write_update",
                    "save_artifact",
                    "search_artifacts",
                    "request_payment",
                    "request_wallet_payment (protected)",
                    "get_wallet_payment (protected)",
                  ].map((t) => (
                    <code key={t}>{t}()</code>
                  ))}
                </div>
              </section>
            </>
          )}
        </main>
        <footer>
          Shared state for the agent ecosystem.
          <span>Synthetic workspace · No real bookings</span>
        </footer>
      </div>
      {modal && (
        <Dialog
          title={
            (
              {
                project: "New project",
                context: selected ? "Edit context" : "Add context",
                permission: "Spending approval rule",
                task: selected ? "Edit task" : "New task",
                update: "Add agent output",
                upload: "Upload artifact",
                "text-artifact": "Save text artifact",
                source: "Source provenance",
                "artifact-detail": "Artifact details",
                payment: "Request test payment",
                "review-payment": "Review test payment",
                review: "Review proposed context",
              } as Record<string, string>
            )[modal] ?? modal
          }
          onClose={() => !busy && setModal(null)}
        >
          {modal === "project" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                const amount = field(f, "budget");
                run(
                  "create_project",
                  {
                    name: field(f, "name"),
                    goal: field(f, "goal"),
                    type: field(f, "type"),
                    ...(amount
                      ? {
                          budget_total_cents: Math.round(Number(amount) * 100),
                          approval_threshold_cents: 20000,
                        }
                      : {}),
                  },
                  (r) => {
                    setModal(null);
                    navigate("project", r.id);
                  },
                );
              }}
            >
              <label>
                Name
                <input name="name" required maxLength={200} />
              </label>
              <label>
                Goal
                <textarea name="goal" required rows={3} />
              </label>
              <label>
                Project type
                <select name="type">
                  <option value="work">Knowledge / work</option>
                  <option value="personal">Personal errand</option>
                </select>
              </label>
              <label>
                Budget in USD (optional)
                <input name="budget" type="number" min="1" step="0.01" />
              </label>
              <button className="primary" disabled={busy}>
                Create project
              </button>
            </form>
          )}
          {modal === "context" && (
            <form onSubmit={submitContext}>
              <label>
                Type
                <select
                  name="kind"
                  defaultValue={
                    selected?.data.kind ??
                    (page === "personal" ? "preference" : "knowledge")
                  }
                >
                  {kinds
                    .filter((k) => k !== "permission")
                    .map((k) => (
                      <option key={k} value={k}>
                        {labels[k]}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Content
                <textarea
                  required
                  name="content"
                  rows={5}
                  defaultValue={selected?.data.content}
                />
              </label>
              {selected && (
                <p className="secondary">
                  The previous version will be preserved as superseded.
                </p>
              )}
              <button className="primary" disabled={busy}>
                Save context
              </button>
            </form>
          )}
          {modal === "permission" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                run(
                  "set_permission",
                  {
                    approval_threshold_cents: Math.round(
                      Number(field(e.currentTarget, "amount")) * 100,
                    ),
                  },
                  () => setModal(null),
                );
              }}
            >
              <p>
                Every payment still requires human Checkout. This rule
                additionally flags larger purchases for explicit approval.
              </p>
              <label>
                Approval required above (USD)
                <input
                  required
                  type="number"
                  name="amount"
                  min="0"
                  step="0.01"
                  defaultValue={
                    selected?.data.approval_threshold_cents / 100 || 200
                  }
                />
              </label>
              <button className="primary" disabled={busy}>
                Save spending rule
              </button>
            </form>
          )}
          {modal === "task" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                run(
                  "write_update",
                  {
                    project_id: projectId,
                    state_delta: [
                      {
                        op: selected ? "update_task" : "create_task",
                        ...(selected ? { id: selected.id } : {}),
                        title: field(f, "title"),
                        description: field(f, "description"),
                        status: field(f, "status"),
                        confidence: 1,
                      },
                    ],
                    request_id: crypto.randomUUID(),
                    expected_revision: project?.revision,
                  },
                  () => setModal(null),
                );
              }}
            >
              <label>
                Title
                <input
                  required
                  name="title"
                  defaultValue={selected?.data.title}
                />
              </label>
              <label>
                Description
                <textarea
                  name="description"
                  rows={3}
                  defaultValue={selected?.data.description}
                />
              </label>
              <label>
                Status
                <select
                  name="status"
                  defaultValue={selected?.data.status ?? "pending"}
                >
                  <option value="pending">Pending</option>
                  <option value="in_progress">In progress</option>
                  <option value="completed">Completed</option>
                </select>
              </label>
              <button className="primary" disabled={busy}>
                Save task
              </button>
            </form>
          )}
          {modal === "update" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                run(
                  "ingest_output",
                  {
                    project_id: projectId,
                    text: field(f, "text"),
                    source_agent: field(f, "agent"),
                    request_id: crypto.randomUUID(),
                  },
                  setResult,
                );
              }}
            >
              <label>
                Source agent
                <select name="agent">
                  <option>Claude</option>
                  <option>ChatGPT</option>
                  <option>Human</option>
                </select>
              </label>
              <label>
                Meaningful output
                <textarea
                  required
                  name="text"
                  rows={7}
                  placeholder="Paste supported findings, explicit decisions, and completed work…"
                />
              </label>
              <button className="primary" disabled={busy}>
                {busy ? "Extracting state…" : "Extract and save changes"}
              </button>
              {result && (
                <div className="result">
                  <h3>Accepted changes</h3>
                  {result.accepted?.map((r: any, i: number) => (
                    <p key={i}>
                      ✓ {r.operation.replaceAll("_", " ")} {r.content ?? ""}
                    </p>
                  ))}
                  {result.review?.length > 0 && (
                    <>
                      <h3>Needs review</h3>
                      <pre>{JSON.stringify(result.review, null, 2)}</pre>
                    </>
                  )}
                </div>
              )}
            </form>
          )}
          {modal === "upload" && (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const file = (
                  e.currentTarget.elements.namedItem("file") as HTMLInputElement
                ).files?.[0];
                if (!file) return;
                setBusy(true);
                setError("");
                try {
                  const r = await api("begin_upload", {
                    project_id: projectId,
                    name: file.name,
                    mime: file.type || "application/octet-stream",
                    size: file.size,
                  });
                  const res = await fetch(r.upload_url, {
                    method: "PUT",
                    headers: {
                      "Content-Type": file.type || "application/octet-stream",
                    },
                    body: file,
                  });
                  if (!res.ok)
                    throw new Error(
                      "Upload failed; select the file and try again.",
                    );
                  await api("process_artifact", { id: r.artifact.id });
                  setModal(null);
                  await load();
                } catch (e) {
                  setError((e as Error).message);
                  await load();
                } finally {
                  setBusy(false);
                }
              }}
            >
              <label className="upload-zone">
                <Upload size={30} />
                <strong>Choose a project artifact</strong>
                <span>PDF, image, document, or spreadsheet · Up to 10 MB</span>
                <input name="file" type="file" required />
              </label>
              <p className="secondary">
                PDFs (up to 20 pages), PNG, and JPEG are parsed. Other formats
                are stored as originals.
              </p>
              <button className="primary" disabled={busy}>
                {busy ? "Uploading and processing…" : "Upload and process"}
              </button>
            </form>
          )}
          {modal === "text-artifact" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                run(
                  "save_artifact",
                  {
                    project_id: projectId,
                    artifact: {
                      name: field(f, "name"),
                      text: field(f, "text"),
                      ...(field(f, "parent")
                        ? { parent_artifact_id: field(f, "parent") }
                        : {}),
                      ...(field(f, "replaces")
                        ? { replaces_artifact_id: field(f, "replaces") }
                        : {}),
                    },
                  },
                  () => setModal(null),
                );
              }}
            >
              <label>
                File name
                <input required name="name" defaultValue="memo.md" />
              </label>
              <label>
                Parent artifact
                <select name="parent">
                  <option value="">None</option>
                  {artifacts
                    .filter((a) => a.data.status === "active")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.data.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Replaces a previous version
                <select name="replaces">
                  <option value="">New artifact</option>
                  {artifacts
                    .filter((a) => a.data.status === "active")
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.data.name} · v{a.data.version}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Content
                <textarea required name="text" rows={10} />
              </label>
              <button className="primary" disabled={busy}>
                Save artifact
              </button>
            </form>
          )}
          {modal === "source" && (
            <div className="padded">
              <h3>{detail?.data?.source_agent ?? "Source unavailable"}</h3>
              <p className="metadata">
                {detail?.data?.source_type?.replaceAll("_", " ")}
                {detail?.created_at ? ` · ${time(detail.created_at)}` : ""}
              </p>
              {detail?.data?.artifact_id && (
                <p>
                  Artifact:{" "}
                  {data.artifacts.find(
                    (a: Row) => a.id === detail.data.artifact_id,
                  )?.data.name ?? detail.data.artifact_id}
                </p>
              )}
              <div className="passage">
                <p>
                  {detail?.data?.excerpt ?? "No source excerpt is available."}
                </p>
              </div>
              <details>
                <summary>Record details</summary>
                <pre>{JSON.stringify(detail, null, 2)}</pre>
              </details>
            </div>
          )}
          {modal === "artifact-detail" && detail && (
            <div className="padded">
              <h3>{detail.artifact.data.name}</h3>
              <p>{detail.artifact.data.summary}</p>
              {detail.download_url && (
                <a
                  className="button"
                  href={detail.download_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Download size={16} />
                  Download original
                </a>
              )}
              {detail.artifact.data.parent_artifact_id && (
                <p>
                  Parent:{" "}
                  {artifacts.find(
                    (a) => a.id === detail.artifact.data.parent_artifact_id,
                  )?.data.name ?? detail.artifact.data.parent_artifact_id}
                </p>
              )}
              {detail.chunks.map((c: Row) => (
                <div className="passage" key={c.id}>
                  <strong>{c.data.locator}</strong>
                  <p>{c.data.text}</p>
                </div>
              ))}
            </div>
          )}
          {modal === "payment" && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const f = e.currentTarget;
                run(
                  "request_payment",
                  {
                    project_id: projectId,
                    amount_cents: Math.round(Number(field(f, "amount")) * 100),
                    category: field(f, "category"),
                    description: field(f, "description"),
                    request_id: crypto.randomUUID(),
                  },
                  (r) => {
                    setSelected(r.transaction);
                    setModal("review-payment");
                  },
                );
              }}
            >
              <label>
                Description
                <input
                  required
                  name="description"
                  placeholder="Boutique hotel — simulated booking"
                />
              </label>
              <label>
                Category
                <select name="category">
                  <option>Hotel</option>
                  <option>Winery</option>
                  <option>Dinner</option>
                  <option>Other</option>
                </select>
              </label>
              <label>
                Amount (USD)
                <input
                  required
                  name="amount"
                  type="number"
                  min="0.01"
                  step="0.01"
                  defaultValue="410"
                />
              </label>
              <p className="secondary">
                This reserves budget and creates a review request. It does not
                charge a card.
              </p>
              <button className="primary" disabled={busy}>
                Create payment request
              </button>
            </form>
          )}
          {modal === "review-payment" && selected && (
            <div className="padded payment-review">
              <Badge tone="amber">Stripe test mode</Badge>
              <h3>{selected.data.description}</h3>
              <div className="payment-amount">
                {money(selected.data.amount_cents)}
              </div>
              <p>
                {selected.data.requires_approval
                  ? "This exceeds your approval threshold. Review and explicitly approve before continuing."
                  : "Review this request before continuing to Checkout."}
              </p>
              <p className="secondary">
                No real booking will be made. Use Stripe test payment details
                only.
              </p>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run("checkout", { id: selected.id }, (r) => {
                    window.location.href = r.url;
                  })
                }
              >
                {busy ? "Opening Checkout…" : "Approve and open test Checkout"}
                <ExternalLink size={16} />
              </button>
            </div>
          )}
          {modal === "review" && detail && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const replace = field(e.currentTarget, "replaces");
                run(
                  "resolve_review",
                  {
                    id: selected?.id,
                    index: detail.review_index,
                    resolution: "apply",
                    expected_revision: project?.revision,
                    ...(replace ? { replaces_id: replace } : {}),
                  },
                  () => setModal(null),
                );
              }}
            >
              <p>
                {detail.content ??
                  detail.title ??
                  detail.op?.replaceAll("_", " ")}
              </p>
              <p className="warning-text">{detail.conflict_reason}</p>
              {["add_context", "supersede_context"].includes(detail.op) && (
                <label>
                  Replace an existing item
                  <select name="replaces" defaultValue={detail.id ?? ""}>
                    <option value="">Keep as a separate item</option>
                    {current
                      .filter((r) => r.data.kind === detail.kind)
                      .map((r) => (
                        <option value={r.id} key={r.id}>
                          {r.data.content}
                        </option>
                      ))}
                  </select>
                </label>
              )}
              <div className="row spread">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    run(
                      "resolve_review",
                      {
                        id: selected?.id,
                        index: detail.review_index,
                        resolution: "dismiss",
                      },
                      () => setModal(null),
                    )
                  }
                >
                  Dismiss proposal
                </button>
                <button className="primary" disabled={busy}>
                  Apply reviewed change
                </button>
              </div>
            </form>
          )}
          {error && (
            <p className="dialog-error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
      {busy && (
        <div className="working" role="status">
          <span className="spinner" />
          Saving shared state…
        </div>
      )}
    </div>
  );
}
