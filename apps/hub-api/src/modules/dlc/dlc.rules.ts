// DLC-R11 · DLC-R12 · luật thuần: đọc trạng thái hội thoại DLC (`cli_sessions.session_id` = JSON `{p, r}` do Agent Runtime
// ghi, `runtimes/dlc/job_run.py` `DlcState`) và chuyển node của engine (`GET /api/runs/{r}/nodes`) sang contract chat.
import { DLC_NODE_STATES, DLC_NODES_MAX, type DlcNode } from "@ai/contracts/chat";

export type DlcSession = { project: string | null; run: string | null };

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
const int = (v: unknown): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
const ms = (v: unknown): number | null => (typeof v === "number" && v > 0 ? Math.round(v) : null);

export function parseSession(raw: string | null | undefined): DlcSession {
  try {
    const d = JSON.parse(raw ?? "{}") as unknown;
    if (!d || typeof d !== "object") return { project: null, run: null };
    const o = d as Record<string, unknown>;
    return { project: str(o.p), run: str(o.r) };
  } catch {
    return { project: null, run: null };
  }
}

/** Run id an toàn để ghép vào path (`R20261016-152126-167c`). */
export const isRunId = (v: string): boolean => /^[A-Za-z0-9._-]{1,120}$/.test(v);

const nodeState = (v: unknown): DlcNode["state"] =>
  (DLC_NODE_STATES as readonly string[]).includes(String(v)) ? (v as DlcNode["state"]) : "pending";

export function toNode(raw: unknown): DlcNode | null {
  if (!raw || typeof raw !== "object") return null;
  const n = raw as Record<string, unknown>;
  const id = str(n.id);
  if (!id) return null;
  const c = (n.counts && typeof n.counts === "object" ? n.counts : {}) as Record<string, unknown>;
  const roles = Array.isArray(n.roles)
    ? n.roles.filter((r): r is string => typeof r === "string")
    : [];
  return {
    id: id.slice(0, 200),
    title: (str(n.title) ?? id).slice(0, 200),
    state: nodeState(n.state),
    roles: roles.slice(0, 50).map((r) => r.slice(0, 100)),
    started_ms: ms(n.started_ms),
    ended_ms: ms(n.ended_ms),
    llm_calls: int(c.llm_calls),
    usd: typeof c.usd === "number" && c.usd > 0 ? c.usd : 0,
    tokens_in: int(c.tokens_in),
    tokens_out: int(c.tokens_out),
    units: typeof c.units === "number" ? int(c.units) : null,
    merged: typeof c.merged === "number" ? int(c.merged) : null,
  };
}

export function toNodes(raw: unknown): DlcNode[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(toNode)
    .filter((n): n is DlcNode => n !== null)
    .slice(0, DLC_NODES_MAX);
}
