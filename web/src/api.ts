export type MemberState = "registered" | "joined" | "introduced" | "active" | "submitted";

export interface Member {
  id: string;
  handle: string;
  country?: string;
  state: MemberState;
  stateSince: number;
  lastMessageAt?: number;
  submittedAt?: number;
}

export interface StateResponse {
  now: string;
  deadline: string;
  event: string;
  members: Member[];
  provider: string;
  mode: "live" | "synthetic-replay";
  synthetic: boolean;
}

export type StallKind =
  | "registered-no-join"
  | "joined-no-intro"
  | "gone-quiet"
  | "missing-submission";

export interface RadarFlag {
  memberId: string;
  handle: string;
  kind: StallKind;
  since: number;
  detail: string;
}

export type DraftStatus = "pending" | "approved" | "rejected" | "send_failed" | "simulated" | "sent";

export interface OutreachDraft {
  id: string;
  memberId: string;
  handle: string;
  kind: StallKind;
  text: string;
  createdAt: number;
  status: DraftStatus;
  decidedBy?: string;
  decidedAt?: number;
  sentAt?: number;
  reference?: string;
  lastError?: string;
}

export interface AuditEvent {
  ts: string;
  kind: string;
  summary: string;
  detail?: unknown;
}

export interface Citation {
  claim: string;
  docId: string;
  url?: string;
}

export interface ConflictSource {
  docId: string;
  title: string;
  url?: string;
  excerpt: string;
}

export interface ConflictBlock {
  severity: "low" | "medium" | "high";
  pair: [string, string];
  explanation: string;
  sources: [ConflictSource, ConflictSource];
  routeTo: string;
}

export interface ContradictionFinding {
  pair: [string, string];
  severity: "low" | "medium" | "high";
  explanation: string;
  verified: boolean;
  anchors?: [string, string];
}

export interface FaqResult {
  question: string;
  decision: "answered" | "escalated" | "conflicted";
  answer?: string;
  citations?: Citation[];
  conflict?: ConflictBlock;
  alerts?: {
    kind: "doc-conflict";
    severity: "low" | "medium" | "high";
    pair: [string, string];
    explanation: string;
    verified: true;
  }[];
  escalation?: { reasons: string[]; routeTo: string };
  trace: { retrieved: { docId: string; score: number }[]; gateReasons?: string[] };
}

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) msg = body.error;
    } catch {
      // keep default message
    }
    throw new Error(msg);
  }
  return res.json() as Promise<T>;
}

export const api = {
  state: () => fetch("/api/state").then((r) => j<StateResponse>(r)),
  radar: () => fetch("/api/radar").then((r) => j<RadarFlag[]>(r)),
  draft: () =>
    fetch("/api/radar/draft", { method: "POST" }).then(
      (r) => j<{ created: OutreachDraft[] }>(r),
    ),
  approvals: () => fetch("/api/approvals").then((r) => j<OutreachDraft[]>(r)),
  approve: (id: string, by: string) =>
    fetch(`/api/approvals/${id}/approve`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ by }),
    }).then((r) => j<OutreachDraft>(r)),
  reject: (id: string, by: string, reason?: string) =>
    fetch(`/api/approvals/${id}/reject`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ by, reason }),
    }).then((r) => j<OutreachDraft>(r)),
  retry: (id: string) =>
    fetch(`/api/approvals/${id}/retry`, { method: "POST" }).then((r) => j<OutreachDraft>(r)),
  audit: () => fetch("/api/audit").then((r) => j<AuditEvent[]>(r)),
  outbound: () => fetch("/api/outbound").then((r) => j<OutreachDraft[]>(r)),
  contradictions: () => fetch("/api/contradictions").then((r) => j<ContradictionFinding[]>(r)),
  report: () => fetch("/api/report").then((r) => j<{ markdown: string }>(r)),
  ask: (question: string) =>
    fetch("/api/ask", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ question }),
    }).then((r) => j<FaqResult>(r)),
};
