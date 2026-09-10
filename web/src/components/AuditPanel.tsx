import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Article, Scroll } from "@phosphor-icons/react";
import { api, type AuditEvent } from "../api";
import { Markdown } from "../markdown";

const spring = { type: "spring" as const, stiffness: 170, damping: 22 };

export function AuditPanel({ audit }: { audit: AuditEvent[] }) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <section className="panel panel-audit">
      <h2>
        <Scroll size={16} weight="bold" color="#d4a24e" />
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
            <AnimatePresence initial={false}>
              {audit.map((e) => (
                <motion.tr
                  key={`${e.ts}-${e.kind}-${e.summary}`}
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  transition={spring}
                >
                  <td className="mono muted">{e.ts.slice(0, 19).replace("T", " ")}</td>
                  <td>
                    <span className={`chip audit-${e.kind.split(".")[0]}`}>{e.kind}</span>
                  </td>
                  <td>{e.summary}</td>
                </motion.tr>
              ))}
            </AnimatePresence>
          </tbody>
        </table>
      </div>
      <motion.button
        className="btn"
        disabled={busy}
        whileTap={{ scale: 0.97 }}
        onClick={() => {
          setBusy(true);
          void api
            .report()
            .then((r) => setMarkdown(r.markdown))
            .finally(() => setBusy(false));
        }}
      >
        <Article size={14} weight="bold" />
        {busy ? "Generating…" : markdown ? "Refresh sponsor report" : "Generate sponsor report"}
      </motion.button>
      <AnimatePresence>
        {markdown && (
          <motion.div
            className="report"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={spring}
          >
            <Markdown source={markdown} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}
