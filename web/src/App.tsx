import { useCallback, useEffect, useState } from "react";
import { MotionConfig, motion } from "motion/react";
import {
  api,
  type AuditEvent,
  type OutreachDraft,
  type RadarFlag,
  type StateResponse,
} from "./api";
import { TopBar } from "./components/TopBar";
import { AskPanel } from "./components/AskPanel";
import { RadarPanel } from "./components/RadarPanel";
import { ApprovalsPanel } from "./components/ApprovalsPanel";
import { AuditPanel } from "./components/AuditPanel";

const panelSpring = { type: "spring" as const, stiffness: 150, damping: 20 };

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

  return (
    <MotionConfig reducedMotion="user">
      <div className="backdrop" />
      <div className="app">
        <TopBar state={state} />
        {error && <div className="error-banner">API error: {error}</div>}
        <main className="grid">
          <motion.div
            className="panel-ask"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={panelSpring}
          >
            <AskPanel />
          </motion.div>
          <div className="rail">
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
          <motion.div
            style={{ gridColumn: "1 / -1" }}
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...panelSpring, delay: 0.24 }}
          >
            <AuditPanel audit={audit} />
          </motion.div>
        </main>
      </div>
    </MotionConfig>
  );
}
