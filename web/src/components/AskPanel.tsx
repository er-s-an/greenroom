import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  CheckCircle,
  Fingerprint,
  MagnifyingGlass,
  ShieldCheck,
  ArrowsLeftRight,
  UserFocus,
  WarningDiamond,
} from "@phosphor-icons/react";
import { api, type ConflictBlock, type FaqResult } from "../api";

const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

export function AskPanel({ onResolved }: { onResolved?: () => Promise<void> }) {
  const [question, setQuestion] = useState("can companies participate??");
  const [result, setResult] = useState<FaqResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && result) {
      const timer = window.setTimeout(() => {
        const target = resultRef.current?.querySelector(".conflict-card") ?? resultRef.current;
        if (target) {
          const root = document.documentElement;
          const body = document.body;
          const previousRoot = root.style.getPropertyValue("scroll-behavior");
          const previousBody = body.style.getPropertyValue("scroll-behavior");
          root.style.setProperty("scroll-behavior", "auto", "important");
          body.style.setProperty("scroll-behavior", "auto", "important");
          target.scrollIntoView({ block: "start", behavior: "auto" });
          window.scrollBy(0, -12);
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => {
              previousRoot
                ? root.style.setProperty("scroll-behavior", previousRoot)
                : root.style.removeProperty("scroll-behavior");
              previousBody
                ? body.style.setProperty("scroll-behavior", previousBody)
                : body.style.removeProperty("scroll-behavior");
            });
          });
        }
      }, 720);
      return () => window.clearTimeout(timer);
    }
  }, [loading, result]);

  const ask = async (q: string) => {
    if (!q.trim()) return;
    setLoading(true);
    setErr(null);
    try {
      const next = await api.ask(q);
      setResult(next);
      await onResolved?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="ask-workbench" id="case-desk">
      <header className="case-header">
        <div className="case-number">01</div>
        <div>
          <p className="eyebrow">Asha’s decision desk · synthetic persona</p>
          <h2>Resolve one participant question without guessing</h2>
        </div>
        <span className="case-policy">
          <ShieldCheck size={15} weight="fill" /> evidence-bound
        </span>
      </header>

      <label className="field-label" htmlFor="participant-question">
        Participant message · 2:07 AM
      </label>
      <div className="ask-row">
        <input
          id="participant-question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void ask(question);
          }}
          placeholder="e.g. Can a startup team join?? we're incorporated"
          aria-label="question"
        />
        <motion.button
          className="btn btn-primary"
          disabled={loading}
          onClick={() => void ask(question)}
          whileTap={{ scale: 0.98 }}
        >
          <MagnifyingGlass size={16} weight="bold" />
          {loading ? "Checking sources…" : "Run source check"}
        </motion.button>
      </div>
      <p className="participant-context">Context: incorporated startup team · deadline approaching</p>
      {err && <div className="error-banner">{err}</div>}
      <div className="resolution-stage" aria-live="polite">
        <AnimatePresence mode="wait">
          {!loading && !result && !err && (
            <motion.div
              key="path"
              className="evidence-path"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.4, delay: 0.1 }}
            >
              <div><span>01</span><strong>AI interprets</strong><small>messy language</small></div>
              <ArrowRight size={17} aria-hidden />
              <div><span>02</span><strong>Sources retrieved</strong><small>official corpus</small></div>
              <ArrowRight size={17} aria-hidden />
              <div><span>03</span><strong>Gate decides</strong><small>answer or stop</small></div>
              <ArrowRight size={17} aria-hidden />
              <div><span>04</span><strong>Outcome recorded</strong><small>auditable receipt</small></div>
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
              ref={resultRef}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={spring}
            >
              <DecisionTrace result={result} />
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
              {result.decision === "conflicted" && result.conflict ? (
                <ConflictCard conflict={result.conflict} withheldDraft={result.withheldDraft} />
              ) : result.decision === "answered" ? (
                <div className="answer-card">
                  <div className="answer-head">
                    <CheckCircle size={21} weight="fill" />
                    <div>
                      <p className="eyebrow">Gate passed · answer permitted</p>
                      <h3>Source-grounded answer</h3>
                    </div>
                  </div>
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
                </div>
              ) : (
                <div className="escalation-card">
                  <div className="answer-head escalation-head">
                    <UserFocus size={21} weight="fill" />
                    <div>
                      <p className="eyebrow">Gate stopped · source missing</p>
                      <h3>Escalated to a human</h3>
                    </div>
                  </div>
                  <ul>
                    {result.escalation?.reasons.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                  <p className="muted">{result.escalation?.routeTo}</p>
                </div>
              )}
              <div className="audit-receipt">
                <Fingerprint size={17} weight="bold" />
                <span>Audit receipt</span>
                <code>{result.decision === "conflicted" ? "conflicted · withheld · human review required" : `faq.${result.decision}`}</code>
                <strong>recorded</strong>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}

function DecisionTrace({ result }: { result: FaqResult }) {
  const outcome = result.decision === "answered" ? "PERMIT" : result.decision === "conflicted" ? "STOP" : "ROUTE";
  return (
    <div className="decision-trace" aria-label="Decision trace">
      <span><b>01</b> interpreted</span>
      <ArrowRight size={13} aria-hidden />
      <span><b>02</b> {result.trace.retrieved.length} sources</span>
      <ArrowRight size={13} aria-hidden />
      <span><b>03</b> deterministic gate</span>
      <ArrowRight size={13} aria-hidden />
      <strong className={`trace-${result.decision}`}>{outcome}</strong>
    </div>
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

function focusedExcerpt(source: ConflictBlock["sources"][number]): string {
  if (source.docId === "eligibility.rules_text" && source.excerpt.includes("Startup founders")) {
    return "Startup founders and entrepreneurs";
  }
  return source.excerpt;
}

/**
 * Fail-closed card: official sources contradict each other on the very fact
 * asked about, so Greenroom refuses to pick a side. Both sources are shown
 * verbatim, the conflict carries its actual verification provenance
 * (human review during corpus curation — no organizer endorsement implied),
 * and the participant gets the human route instead of a coin-flip answer.
 */
function ConflictCard({
  conflict,
  withheldDraft,
}: {
  conflict: ConflictBlock;
  withheldDraft?: { text: string; provider: string };
}) {
  return (
    <motion.div
      className="conflict-card"
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={spring}
    >
      {withheldDraft && (
        <div className="withheld-draft">
          <div>
            <span>AI draft</span>
            <strong>{withheldDraft.provider.includes("kimi") ? "Kimi (hosted)" : "mock test double"}</strong>
          </div>
          <p>{withheldDraft.text}</p>
          <span className="withheld-status">withheld · unsent</span>
        </div>
      )}
      <div className="conflict-head">
        <span className="stop-mark">DRAFT WITHHELD</span>
        <div>
          <p className="eyebrow"><PulseIcon severity={conflict.severity} /> registered conflict gate · high severity</p>
          <h3>Two official sources. No safe verdict.</h3>
          <p>Greenroom refuses to manufacture certainty.</p>
        </div>
        <span className="chip chip-verified">{conflict.verifiedBy ?? "human-reviewed"}</span>
      </div>
      <div className="conflict-vs">
        {conflict.sources.map((s, i) => (
          <motion.blockquote
            key={s.docId}
            className="conflict-source"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.12 + i * 0.09 }}
          >
            <span className="source-label">
              Official source {String.fromCharCode(65 + i)} · {s.title}
            </span>
            <p>“{focusedExcerpt(s)}”</p>
            <footer>
              <span className="mono doc-id">{s.docId}</span>
              {s.url && (
                <a href={s.url} target="_blank" rel="noreferrer">
                  source
                </a>
              )}
            </footer>
          </motion.blockquote>
        ))}
        <span className="conflict-divider" aria-hidden>
          <ArrowsLeftRight size={18} weight="bold" />
        </span>
      </div>
      <p className="conflict-explanation">{conflict.explanation}</p>
      <div className="conflict-route">
        <UserFocus size={20} weight="fill" />
        <div>
          <span>No safe verdict · sources attached for human review</span>
          <strong>Saved organizer contact (September 10 snapshot): {conflict.routeTo}</strong>
        </div>
      </div>
    </motion.div>
  );
}
