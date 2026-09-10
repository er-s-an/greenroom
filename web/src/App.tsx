import { useCallback, useEffect, useRef, useState } from "react";
import {
  api,
  type AuditEvent,
  type FaqResult,
  type OutreachDraft,
  type RadarFlag,
  type StallKind,
  type StateResponse,
} from "./api";
import { Markdown } from "./markdown";

const EXAMPLE_QUESTIONS = [
  "Can companies participate?",
  "do I have to join Discord?",
  "what's the wifi password?",
];

const KIND_LABEL: Record<StallKind, string> = {
  "registered-no-join": "registered · no join",
  "joined-no-intro": "joined · no intro",
  "gone-quiet": "gone quiet",
  "missing-submission": "missing submission",
};

const STATE_ORDER = ["registered", "joined", "introduced", "active", "submitted"] as const;

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export default function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [flags, setFlags] = useState<RadarFlag[]>([]);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, f, d, a] = await Promise.all([
        api.state(),
        api.radar(),
        api.approvals(),
        api.audit(),
      ]);
      setState(s);
      setFlags(f);
      setDrafts(d);
      setAudit(a);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 3000);
    return () => clearInterval(t);
  }, [refresh]);

  const hoursToDeadline =
    state && state.deadline ? (new Date(state.deadline).getTime() - new Date(state.now).getTime()) / 3_600_000 : null;

  return (
    <div className="app">
      <header className="topbar">
        <div className="wordmark">
          <span className="wordmark-dot" />
          Greenroom
        </div>
        {state && (
          <div className="topbar-meta">
            <span className="chip chip-event">{state?.event ?? "…"}</span>
            <span className={`chip ${hoursToDeadline !== null && hoursToDeadline < 72 ? "chip-amber" : "chip-green"}`}>
              {hoursToDeadline !== null ? `${Math.max(0, Math.round(hoursToDeadline))}h to deadline` : "—"}
            </span>
            <span className="chip chip-provider">llm: {state?.provider}</span>
          </div>
        )}
      </header>
      {error && <div className="error-banner">API error: {error}</div>}
      <main className="grid">
        <AskPanel />
        <RadarPanel flags={flags} onDrafted={refresh} />
        <ApprovalsPanel drafts={drafts} onAction={refresh} />
        <AuditPanel audit={audit} />
      </main>
    </div>
  );
}

function AskPanel() {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<FaqResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      setResult(await api.ask(q));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="panel panel-ask">
      <h2>
        Ask the community copilot <span className="panel-tag">cited answers only</span>
      </h2>
      <div className="ask-row">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask(question);
          }}
          placeholder="Ask about eligibility, deadlines, rules…"
        />
        <button className="btn btn-primary" disabled={loading} onClick={() => void ask(question)}>
          {loading ? "Asking…" : "Ask"}
        </button>
      </div>
      <div className="chips">
        {EXAMPLE_QUESTIONS.map((q) => (
          <button key={q} className="chip chip-example" onClick={() => { setQuestion(q); void ask(q); }}>
            {q}
          </button>
        ))}
      </div>
      {err && <div className="error-banner">{err}</div>}
      {result && (
        <div className="ask-result">
          {result.alerts && result.alerts.length > 0 && (
            <div className={`alert-banner ${result.alerts[0]?.severity === "high" ? "alert-red" : "alert-amber"}`}>
              <strong>⚑ Organizer alert — documentation conflict</strong>
              {result.alerts.map((a, i) => (
                <div key={i} className="alert-body">
                  <span className="mono">{a.pair.join(" × ")}</span> — {a.explanation}
                </div>
              ))}
            </div>
          )}
          {result.decision === "answered" ? (
            <>
              <p className="answer">{result.answer}</p>
              {result.citations && result.citations.length > 0 && (
                <div className="citations">
                  <h3>Citations</h3>
                  <ul>
                    {result.citations.map((c, i) => (
                      <li key={i}>
                        <span className="mono doc-id">{c.docId}</span>
                        {c.url ? (
                          <a href={c.url} target="_blank" rel="noreferrer">
                            {c.url}
                          </a>
                        ) : (
                          <span className="muted">no public url</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          ) : (
            <div className="escalation-card">
              <h3>Escalated to a human</h3>
              <ul>
                {result.escalation?.reasons.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
              <p className="muted">{result.escalation?.routeTo}</p>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function RadarPanel({ flags, onDrafted }: { flags: RadarFlag[]; onDrafted: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [state, setState] = useState<StateResponse | null>(null);
  useEffect(() => {
    void api.state().then(setState);
  }, []);

  const funnel = new Map<string, number>();
  for (const m of state?.members ?? []) funnel.set(m.state, (funnel.get(m.state) ?? 0) + 1);

  return (
    <section className="panel">
      <h2>
        Stall radar <span className="panel-tag">{flags.length} flagged</span>
      </h2>
      <div className="funnel">
        {STATE_ORDER.map((s) => (
          <div key={s} className="funnel-cell">
            <div className="funnel-count">{funnel.get(s) ?? 0}</div>
            <div className="funnel-label">{s}</div>
          </div>
        ))}
      </div>
      {flags.length === 0 ? (
        <p className="muted">No stalls detected at the demo clock. Everyone is moving.</p>
      ) : (
        <table className="flags-table">
          <thead>
            <tr>
              <th>handle</th>
              <th>kind</th>
              <th>detail</th>
            </tr>
          </thead>
          <tbody>
            {flags.map((f) => (
              <tr key={f.memberId}>
                <td className="mono">{f.handle}</td>
                <td>
                  <span className={`chip kind-${f.kind}`}>{KIND_LABEL[f.kind]}</span>
                </td>
                <td className="muted">{f.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <button
        className="btn"
        disabled={busy || flags.length === 0}
        onClick={() => {
          setBusy(true);
          void api
            .draft()
            .then(() => onDrafted())
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Drafting…" : "Draft outreach for all flagged"}
      </button>
    </section>
  );
}

function ApprovalsPanel({ drafts, onAction }: { drafts: OutreachDraft[]; onAction: () => Promise<void> }) {
  const [busy, setBusy] = useState<string | null>(null);
  const act = (p: Promise<unknown>) => {
    setBusy("x");
    void p.then(() => onAction()).finally(() => setBusy(null));
  };
  const pending = drafts.filter((d) => d.status === "pending").length;

  return (
    <section className="panel">
      <h2>
        Approval queue <span className="panel-tag">{pending} pending</span>
      </h2>
      <p className="muted note">Nothing is sent without a human click.</p>
      {drafts.length === 0 ? (
        <p className="muted">No drafts yet — run the stall radar to draft outreach.</p>
      ) : (
        <div className="draft-list">
          {drafts.map((d) => (
            <div key={d.id} className={`draft-card status-${d.status}`}>
              <div className="draft-head">
                <span className="mono">@{d.handle}</span>
                <span className={`chip kind-${d.kind}`}>{KIND_LABEL[d.kind]}</span>
                <span className={`badge badge-${d.status}`}>{d.status}</span>
              </div>
              <p className="draft-text">{d.text}</p>
              {d.status === "pending" && (
                <div className="draft-actions">
                  <button
                    className="btn btn-small btn-primary"
                    disabled={busy !== null}
                    onClick={() => act(api.approve(d.id, "organizer-demo"))}
                  >
                    Approve
                  </button>
                  <button
                    className="btn btn-small"
                    disabled={busy !== null}
                    onClick={() => act(api.reject(d.id, "organizer-demo", "rejected from console"))}
                  >
                    Reject
                  </button>
                </div>
              )}
              {d.decidedBy && (
                <p className="muted draft-meta">
                  {d.status} by {d.decidedBy}
                  {d.sentAt ? ` · sent ${fmtDate(d.sentAt)}` : ""}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function AuditPanel({ audit }: { audit: AuditEvent[] }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel">
      <h2>
        Audit trail <span className="panel-tag">{audit.length} events</span>
      </h2>
      <div className="audit-table-wrap">
        <table className="audit-table">
          <thead>
            <tr>
              <th>ts</th>
              <th>kind</th>
              <th>summary</th>
            </tr>
          </thead>
          <tbody>
            {audit.map((e, i) => (
              <tr key={i}>
                <td className="mono muted">{e.ts.slice(0, 19).replace("T", " ")}</td>
                <td>
                  <span className={`chip audit-${e.kind.split(".")[0]}`}>{e.kind}</span>
                </td>
                <td>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button
        className="btn"
        disabled={busy}
        onClick={() => {
          setBusy(true);
          void api
            .report()
            .then((r) => setMarkdown(r.markdown))
            .finally(() => setBusy(false));
        }}
      >
        {busy ? "Generating…" : markdown ? "Refresh sponsor report" : "Generate sponsor report"}
      </button>
      {markdown && (
        <div className="report">
          <Markdown source={markdown} />
        </div>
      )}
    </section>
  );
}
