import type { StallKind } from "./types.js";
import type { LlmProvider } from "./llm.js";
import type { ApprovalQueue } from "./approvals.js";
import type { AuditLog } from "./audit.js";

export type MemberState = "registered" | "joined" | "introduced" | "active" | "submitted";

export interface Member {
  id: string;
  handle: string;
  country?: string;
  state: MemberState;
  /** ms epoch when the current state was entered. */
  stateSince: number;
  lastMessageAt?: number;
  submittedAt?: number;
}

export type RadarEvent =
  | { type: "register"; memberId: string; handle: string; country?: string; at: number }
  | { type: "join"; memberId: string; at: number }
  | { type: "introduce"; memberId: string; at: number; text: string }
  | { type: "message"; memberId: string; at: number; channel: string; text: string }
  | { type: "submit"; memberId: string; at: number };

const STATE_ORDER: MemberState[] = ["registered", "joined", "introduced", "active", "submitted"];

function rank(state: MemberState): number {
  return STATE_ORDER.indexOf(state);
}

/** Participant lifecycle store. Events move members forward; nothing moves them back. */
export class Community {
  private members = new Map<string, Member>();

  ingest(event: RadarEvent): Member {
    const existing = this.members.get(event.memberId);
    const m = existing ?? {
      id: event.memberId,
      handle: "handle" in event ? event.handle : event.memberId,
      state: "registered" as MemberState,
      stateSince: event.at,
    };
    if (event.type === "register") {
      // Registration facts always refresh, but the lifecycle never moves back:
      // a duplicate/late register must not drag a submitted member to square one.
      m.handle = event.handle;
      m.country = event.country ?? m.country;
      if (!existing) {
        m.state = "registered";
        m.stateSince = event.at;
      }
    } else if (event.type === "join" && rank(m.state) < rank("joined")) {
      m.state = "joined";
      m.stateSince = event.at;
    } else if (event.type === "introduce" && rank(m.state) < rank("introduced")) {
      m.state = "introduced";
      m.stateSince = event.at;
      m.lastMessageAt = event.at;
    } else if (event.type === "message") {
      m.lastMessageAt = event.at;
      if (rank(m.state) === rank("introduced")) {
        m.state = "active";
        m.stateSince = event.at;
      }
    } else if (event.type === "submit" && rank(m.state) < rank("submitted")) {
      m.state = "submitted";
      m.stateSince = event.at;
      m.submittedAt = event.at;
    }
    this.members.set(m.id, m);
    return m;
  }

  get(id: string): Member | undefined {
    return this.members.get(id);
  }

  list(): Member[] {
    return [...this.members.values()];
  }
}

export interface StallThresholds {
  registeredNoJoinHours: number;
  joinedNoIntroHours: number;
  goneQuietHours: number;
  /** Start flagging missing submissions this many hours before the deadline. */
  submissionWindowHours: number;
}

export const DEFAULT_THRESHOLDS: StallThresholds = {
  registeredNoJoinHours: 24,
  joinedNoIntroHours: 12,
  goneQuietHours: 72,
  submissionWindowHours: 72,
};

export interface RadarFlag {
  memberId: string;
  handle: string;
  kind: StallKind;
  /** ms epoch since the member has been stalled. */
  since: number;
  /** Human-readable context for the organizer and the outreach drafter. */
  detail: string;
}

const HOUR = 3_600_000;

function hoursBetween(a: number, b: number): number {
  return (b - a) / HOUR;
}

/**
 * Deterministic stall detection. One flag per member, most-actionable rule wins:
 * registered-no-join > joined-no-intro > gone-quiet > missing-submission.
 * Rationale: someone who never joined needs a "come join" nudge, not a
 * "submit now" nudge — even when the deadline is close.
 */
export function scan(
  community: Community,
  opts: { now: number; deadlineAt: number; thresholds?: StallThresholds },
): RadarFlag[] {
  const t = opts.thresholds ?? DEFAULT_THRESHOLDS;
  const flags: RadarFlag[] = [];

  for (const m of community.list()) {
    if (m.state === "submitted") continue;

    if (m.state === "registered" && hoursBetween(m.stateSince, opts.now) > t.registeredNoJoinHours) {
      flags.push({
        memberId: m.id,
        handle: m.handle,
        kind: "registered-no-join",
        since: m.stateSince,
        detail: `registered ${Math.round(hoursBetween(m.stateSince, opts.now))}h ago, never joined the server`,
      });
    } else if (m.state === "joined" && hoursBetween(m.stateSince, opts.now) > t.joinedNoIntroHours) {
      flags.push({
        memberId: m.id,
        handle: m.handle,
        kind: "joined-no-intro",
        since: m.stateSince,
        detail: `joined ${Math.round(hoursBetween(m.stateSince, opts.now))}h ago, never introduced themselves`,
      });
    } else if (m.state === "introduced" || m.state === "active") {
      const lastSeen = m.lastMessageAt ?? m.stateSince;
      if (hoursBetween(lastSeen, opts.now) > t.goneQuietHours) {
        flags.push({
          memberId: m.id,
          handle: m.handle,
          kind: "gone-quiet",
          since: lastSeen,
          detail: `last message ${Math.round(hoursBetween(lastSeen, opts.now))}h ago, state '${m.state}'`,
        });
        continue;
      }
      const hoursToDeadline = hoursBetween(opts.now, opts.deadlineAt);
      if (hoursToDeadline <= t.submissionWindowHours && hoursToDeadline >= 0) {
        flags.push({
          memberId: m.id,
          handle: m.handle,
          kind: "missing-submission",
          since: m.stateSince,
          detail: `state '${m.state}', deadline in ${Math.round(hoursToDeadline)}h, no submission on record`,
        });
      }
    }
  }

  return flags.sort((a, b) => a.since - b.since);
}

/**
 * Turn radar flags into outreach drafts in the approval queue.
 * Nothing is sent here — the queue gates every message behind a human decision.
 */
export async function draftOutreachForFlags(
  flags: RadarFlag[],
  llm: LlmProvider,
  queue: ApprovalQueue,
  audit?: AuditLog,
): Promise<string[]> {
  const ids: string[] = [];
  for (const flag of flags) {
    const text = await llm.draftOutreach({ handle: flag.handle, kind: flag.kind, context: flag.detail });
    const draft = queue.submit({
      memberId: flag.memberId,
      handle: flag.handle,
      kind: flag.kind,
      text,
    });
    audit?.record("outreach.drafted", `draft ${draft.id} → ${flag.handle} (${flag.kind})`, { draftId: draft.id, flag });
    ids.push(draft.id);
  }
  return ids;
}
