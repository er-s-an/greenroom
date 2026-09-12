import { useCallback, useEffect, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import {
  api,
  type AuditEvent,
  type ContradictionFinding,
  type OutreachDraft,
  type RadarFlag,
  type StateResponse,
} from "./api";
import { TopBar } from "./components/TopBar";
import { AskPanel } from "./components/AskPanel";
import { FindingsPanel } from "./components/FindingsPanel";
import { RadarPanel } from "./components/RadarPanel";
import { ApprovalsPanel } from "./components/ApprovalsPanel";
import { AuditPanel } from "./components/AuditPanel";

const panelSpring = { type: "spring" as const, stiffness: 150, damping: 20 };

export default function App() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [flags, setFlags] = useState<RadarFlag[]>([]);
  const [drafts, setDrafts] = useState<OutreachDraft[]>([]);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [findings, setFindings] = useState<ContradictionFinding[]>([]);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [s, f, d, a, c] = await Promise.all([
        api.state(),
        api.radar(),
        api.approvals(),
        api.audit(),
        api.contradictions(),
      ]);
      setState(s);
      setFlags(f);
      setDrafts(d);
      setAudit(a);
      setFindings(c);
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

  return (
    <MotionConfig reducedMotion="user">
      <div className="backdrop" />
      <div className="app">
        <TopBar state={state} />
        {error && <div className="error-banner">API error: {error}</div>}
        <main>
          <section className="hero-intro" aria-labelledby="hero-title">
            <div className="hero-copy">
              <p className="eyebrow">2:07 AM · volunteer organizer on duty</p>
              <h1 id="hero-title">
                Asha has one question she cannot afford to answer wrong.
              </h1>
              <p className="hero-dek">
                An incorporated team wants to know if it can enter. A confident guess would become
                an eligibility ruling.
              </p>
              <span className="persona-tag">Asha is a synthetic demo persona</span>
            </div>
            <aside className="permission-promise" aria-label="Greenroom's job">
              <span>Greenroom’s job</span>
              <strong>Let AI help. Stop when the evidence cannot carry the answer.</strong>
            </aside>
          </section>

          <motion.div
            className="hero-workbench"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={panelSpring}
          >
            <AskPanel onResolved={refresh} />
          </motion.div>

          <section className="chapter-heading" id="follow-through">
            <p className="eyebrow">Secondary capability</p>
            <div>
              <h2>Controlled follow-through</h2>
              <p>Stall radar is the second example of the same boundary: AI proposes; a human sends.</p>
            </div>
          </section>

          <div className="operations-grid">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...panelSpring, delay: 0.08 }}
            >
              <RadarPanel flags={flags} onDrafted={refresh} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...panelSpring, delay: 0.16 }}
            >
              <ApprovalsPanel drafts={drafts} onAction={refresh} />
            </motion.div>
          </div>

          <section className="chapter-heading chapter-proof" id="proof">
            <p className="eyebrow">The receipt · evidence</p>
            <div>
              <h2>What happened, not what the model claims</h2>
              <p>The audit is the source of truth. Detector candidates remain visibly separate.</p>
            </div>
          </section>

          <div className="proof-grid">
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...panelSpring, delay: 0.24 }}
            >
              <AuditPanel audit={audit} />
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...panelSpring, delay: 0.32 }}
            >
              <FindingsPanel findings={findings} />
            </motion.div>
          </div>
        </main>
      </div>
    </MotionConfig>
  );
}
