import { AnimatePresence, motion } from "motion/react";
import { GitDiff } from "@phosphor-icons/react";
import type { ContradictionFinding } from "../api";

const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

/**
 * The contradiction review queue. Verified findings and raw detector
 * candidates are listed side by side but never look alike: only a human
 * verifier turns a candidate into a fact.
 */
export function FindingsPanel({ findings }: { findings: ContradictionFinding[] }) {
  return (
    <section className="panel">
      <h2>
        <GitDiff size={16} weight="bold" color="#c4634f" />
        Doc conflicts <span className="panel-tag">{findings.length} found</span>
      </h2>
      <p className="muted note">
        Detector proposes, humans dispose. Verified findings fail closed in the FAQ; candidates wait here.
      </p>
      {findings.length === 0 ? (
        <p className="muted">No conflicts detected in the corpus.</p>
      ) : (
        <div className="finding-list" aria-live="polite">
          <AnimatePresence initial={false}>
            {findings.map((f, i) => (
              <motion.div
                key={f.pair.join(" × ")}
                className={`finding-card ${f.verified ? "finding-verified" : "finding-candidate"}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ ...spring, delay: i * 0.05 }}
              >
                <div className="finding-head">
                  <span className={`chip ${f.verified ? "chip-verified" : "chip-candidate"}`}>
                    {f.verified ? "human-reviewed" : "needs review"}
                  </span>
                  <span className={`chip severity-${f.severity}`}>{f.severity}</span>
                </div>
                <p className="mono finding-pair">{f.pair.join(" × ")}</p>
                <p className="finding-explanation">{f.explanation}</p>
                {f.verified && f.verifiedBy && <p className="muted finding-verifiedby">{f.verifiedBy}</p>}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}
