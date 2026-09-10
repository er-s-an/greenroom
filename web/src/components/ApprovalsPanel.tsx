import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, X } from "@phosphor-icons/react";
import { api, type OutreachDraft } from "../api";
import { KIND_LABEL } from "./RadarPanel";

const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").slice(0, 16) + "Z";
}

export function ApprovalsPanel({
  drafts,
  onAction,
}: {
  drafts: OutreachDraft[];
  onAction: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const act = (p: Promise<unknown>) => {
    setBusy(true);
    void p.then(() => onAction()).finally(() => setBusy(false));
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
        <div className="draft-list" aria-live="polite">
          <AnimatePresence initial={false}>
            {drafts.map((d) => (
              <motion.div
                key={d.id}
                className={`draft-card status-${d.status}`}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={spring}
              >
                <div className="draft-head">
                  <span className="mono">@{d.handle}</span>
                  <span className={`chip kind-${d.kind}`}>{KIND_LABEL[d.kind]}</span>
                  <span className={`badge badge-${d.status}`}>{d.status}</span>
                </div>
                <p className="draft-text">{d.text}</p>
                {d.status === "pending" && (
                  <div className="draft-actions">
                    <motion.button
                      className="btn btn-small btn-primary"
                      disabled={busy}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => act(api.approve(d.id, "organizer-demo"))}
                    >
                      <Check size={13} weight="bold" />
                      Approve
                    </motion.button>
                    <motion.button
                      className="btn btn-small"
                      disabled={busy}
                      whileTap={{ scale: 0.95 }}
                      onClick={() => act(api.reject(d.id, "organizer-demo", "rejected from console"))}
                    >
                      <X size={13} weight="bold" />
                      Reject
                    </motion.button>
                  </div>
                )}
                {d.decidedBy && (
                  <p className="muted draft-meta">
                    {d.status} by {d.decidedBy}
                    {d.sentAt ? ` · sent ${fmtDate(d.sentAt)}` : ""}
                  </p>
                )}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
