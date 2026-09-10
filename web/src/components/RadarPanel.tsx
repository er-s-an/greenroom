import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Crosshair, PaperPlaneTilt } from "@phosphor-icons/react";
import { api, type RadarFlag, type StateResponse, type StallKind } from "../api";

export const KIND_LABEL: Record<StallKind, string> = {
  "registered-no-join": "registered · no join",
  "joined-no-intro": "joined · no intro",
  "gone-quiet": "gone quiet",
  "missing-submission": "missing submission",
};

const STATE_ORDER = ["registered", "joined", "introduced", "active", "submitted"] as const;
const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

export function RadarPanel({ flags, onDrafted }: { flags: RadarFlag[]; onDrafted: () => Promise<void> }) {
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
        <Crosshair size={16} weight="bold" color="#d4a24e" />
        Stall radar <span className="panel-tag">{flags.length} flagged</span>
      </h2>
      <div className="funnel">
        {STATE_ORDER.map((s, i) => (
          <motion.div
            key={s}
            className="funnel-cell"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...spring, delay: 0.25 + i * 0.05 }}
          >
            <div className="funnel-count">{funnel.get(s) ?? 0}</div>
            <div className="funnel-label">{s}</div>
          </motion.div>
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
            <AnimatePresence initial={false}>
              {flags.map((f, i) => (
                <motion.tr
                  key={f.memberId}
                  layout
                  initial={{ opacity: 0, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: 8 }}
                  transition={{ ...spring, delay: i * 0.03 }}
                >
                  <td className="mono">{f.handle}</td>
                  <td>
                    <span className={`chip kind-${f.kind}`}>{KIND_LABEL[f.kind]}</span>
                  </td>
                  <td className="muted">{f.detail}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      )}
      <motion.button
        className="btn"
        style={{ marginTop: 14 }}
        disabled={busy || flags.length === 0}
        whileTap={{ scale: 0.97 }}
        onClick={() => {
          setBusy(true);
          void api
            .draft()
            .then(() => onDrafted())
            .finally(() => setBusy(false));
        }}
      >
        <PaperPlaneTilt size={14} weight="bold" />
        {busy ? "Drafting…" : "Draft outreach for all flagged"}
      </motion.button>
    </section>
  );
}
