import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { LinkSimpleHorizontal, MagnifyingGlass, Scroll, ShieldCheck, WarningDiamond } from "@phosphor-icons/react";
import { api, type FaqResult } from "../api";

const EXAMPLE_QUESTIONS = [
  "Can companies participate?",
  "do I have to join Discord?",
  "what's the wifi password?",
];

const GATES = [
  {
    icon: LinkSimpleHorizontal,
    title: "Citation gate",
    body: "Every sentence must cite an official source, or the answer is refused.",
  },
  {
    icon: ShieldCheck,
    title: "Approval gate",
    body: "Outreach is drafted by AI, sent only by a human click.",
  },
  {
    icon: Scroll,
    title: "Audit trail",
    body: "Every action — and every refusal — is recorded.",
  },
];

const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

export function AskPanel() {
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
    <section className="panel">
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
          aria-label="question"
        />
        <motion.button
          className="btn btn-primary"
          disabled={loading}
          onClick={() => void ask(question)}
          whileTap={{ scale: 0.96 }}
        >
          <MagnifyingGlass size={14} weight="bold" />
          {loading ? "Asking…" : "Ask"}
        </motion.button>
      </div>
      <div className="chips">
        {EXAMPLE_QUESTIONS.map((q) => (
          <motion.button
            key={q}
            className="chip chip-example"
            onClick={() => {
              setQuestion(q);
              void ask(q);
            }}
            whileTap={{ scale: 0.95 }}
          >
            {q}
          </motion.button>
        ))}
      </div>
      {err && <div className="error-banner">{err}</div>}
      <div aria-live="polite">
        <AnimatePresence mode="wait">
          {!loading && !result && !err && (
            <motion.div
              key="gates"
              className="gate-explainer"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              {GATES.map((g, i) => (
                <motion.div
                  key={g.title}
                  className="gate-item"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ ...spring, delay: 0.2 + i * 0.09 }}
                >
                  <g.icon size={17} weight="bold" />
                  <h4>{g.title}</h4>
                  <p>{g.body}</p>
                </motion.div>
              ))}
            </motion.div>
          )}
          {loading && (
            <motion.div
              key="skeleton"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              <div className="skeleton" style={{ height: 52, marginTop: 16 }} />
              <div className="skeleton" style={{ height: 18, width: "55%", marginTop: 10 }} />
            </motion.div>
          )}
          {!loading && result && (
            <motion.div
              key={result.question + result.decision}
              className="ask-result"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={spring}
            >
              {result.alerts && result.alerts.length > 0 && (
                <motion.div
                  className={`alert-banner ${result.alerts[0]?.severity === "high" ? "" : "alert-amber"}`}
                  initial={{ opacity: 0, scale: 0.985 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ ...spring, delay: 0.08 }}
                >
                  <strong>
                    <PulseIcon severity={result.alerts[0]?.severity} />
                    Organizer alert — documentation conflict
                  </strong>
                  {result.alerts.map((a, i) => (
                    <div key={i} className="alert-body">
                      <span className="mono">{a.pair.join(" × ")}</span> — {a.explanation}
                    </div>
                  ))}
                </motion.div>
              )}
              {result.decision === "answered" ? (
                <>
                  <p className="answer">{result.answer}</p>
                  {result.citations && result.citations.length > 0 && (
                    <div className="citations">
                      <h3>Citations</h3>
                      <ul>
                        {result.citations.map((c, i) => (
                          <motion.li
                            key={i}
                            initial={{ opacity: 0, x: -8 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ ...spring, delay: 0.15 + i * 0.06 }}
                          >
                            <span className="mono doc-id">{c.docId}</span>
                            {c.url ? (
                              <a href={c.url} target="_blank" rel="noreferrer">
                                {c.url}
                              </a>
                            ) : (
                              <span className="muted">no public url</span>
                            )}
                          </motion.li>
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
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function PulseIcon({ severity }: { severity?: string }) {
  const high = severity === "high";
  return (
    <motion.span
      animate={{ opacity: [1, 0.5, 1] }}
      transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
      style={{ display: "inline-flex" }}
    >
      <WarningDiamond size={16} weight="fill" color={high ? "#c4634f" : "#d4a24e"} />
    </motion.span>
  );
}
