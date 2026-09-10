import { memo } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { StateResponse } from "../api";

/** Breathing "house light" — perpetual micro-animation isolated in a memo leaf. */
const HouseLight = memo(function HouseLight() {
  return (
    <motion.span
      className="wordmark-dot"
      animate={{ opacity: [1, 0.45, 1] }}
      transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
    />
  );
});

export function TopBar({ state }: { state: StateResponse | null }) {
  const hours =
    state?.deadline && state?.now
      ? (new Date(state.deadline).getTime() - new Date(state.now).getTime()) / 3_600_000
      : null;
  const label = hours !== null ? `${Math.max(0, Math.round(hours))}h to deadline` : "—";

  return (
    <header className="topbar">
      <div className="wordmark">
        <HouseLight />
        Greenroom
      </div>
      <div className="topbar-meta">
        <span className="chip chip-event">{state?.event ?? "…"}</span>
        <span className={`chip ${hours !== null && hours < 72 ? "chip-amber" : "chip-green"}`}>
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={label}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
              transition={{ duration: 0.25 }}
              style={{ display: "inline-block" }}
            >
              {label}
            </motion.span>
          </AnimatePresence>
        </span>
        <span className="chip chip-provider">llm: {state?.provider ?? "…"}</span>
      </div>
    </header>
  );
}
