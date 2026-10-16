// DLC-R11 · DLC-R12 · hội thoại DLC của user (sidebar "Workspaces") và process của run hiện tại (modal "Xem Process").
// Đọc DB trong `withHubScope(user)` (RLS hội thoại theo chủ; câu lọc thêm tenant + user + `provider_key = 'dlc'`), rồi đọc
// engine NGOÀI transaction. Hội thoại không phải của user / không có phiên DLC → 404 `NOT_FOUND` (như E5–E11).
import type { DlcProcessResponse, DlcWorkspace, DlcWorkspacesResponse } from "@ai/contracts/chat";
import { DLC_WORKSPACES_MAX } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { withHubScope } from "@ai/db/hub-scope";
import { sql } from "drizzle-orm";
import type { AuthUser } from "../../lib/auth.middleware";
import type { Db } from "../../lib/db";
import { appError } from "../../lib/errors";
import type { DlcEngine, DlcJson } from "./dlc.engine";
import { isRunId, parseSession, toNodes } from "./dlc.rules";

type Row = { id: string; title: string; updated_at: string; session_id: string };

async function sessions(tx: Tx, u: AuthUser, conversationId?: string): Promise<Row[]> {
  const one = conversationId ? sql`and c.id = ${conversationId}` : sql``;
  return tx.execute<Row>(sql`select c.id, c.title,
      to_char(s.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as updated_at, s.session_id
    from hub.conversations c
    join hub.cli_sessions s on s.conversation_id = c.id and s.tenant_id = c.tenant_id
    where c.tenant_id = ${u.tenantId} and c.user_id = ${u.userId} and c.deleted_at is null and c.room_id is null
      and s.provider_key = 'dlc' ${one}
    order by s.updated_at desc limit ${DLC_WORKSPACES_MAX}`);
}

/** Tóm tắt run của engine; lỗi → null (một workspace lỗi không làm hỏng cả danh sách). */
async function runOf(engine: DlcEngine, run: string): Promise<DlcJson | null> {
  if (!isRunId(run)) return null;
  try {
    const body = await engine.get(`/api/runs/${run}`);
    return body.run && typeof body.run === "object" ? (body.run as DlcJson) : null;
  } catch {
    return null;
  }
}

export function dlcService(db: Db, engine?: DlcEngine) {
  const scoped = <T>(u: AuthUser, fn: (tx: Tx) => Promise<T>) =>
    withHubScope(db, { kind: "user", tenantId: u.tenantId, userId: u.userId }, fn);

  async function workspaces(u: AuthUser): Promise<DlcWorkspacesResponse> {
    const rows = await scoped(u, (tx) => sessions(tx, u));
    const items: DlcWorkspace[] = rows.map((r) => ({
      conversation_id: r.id,
      title: r.title,
      ...parseSession(r.session_id),
      run_state: null,
      updated_at: r.updated_at,
    }));
    if (!engine) return { engine: "not_configured", items };
    const runs = await Promise.all(items.map((w) => (w.run ? runOf(engine, w.run) : null)));
    const reached = runs.some((r) => r !== null) || items.every((w) => !w.run);
    items.forEach((w, i) => {
      const st = runs[i]?.state;
      w.run_state = typeof st === "string" ? st.slice(0, 40) : null;
    });
    return { engine: reached ? "ok" : "unreachable", items };
  }

  async function process(u: AuthUser, conversationId: string): Promise<DlcProcessResponse> {
    const [row] = await scoped(u, (tx) => sessions(tx, u, conversationId));
    if (!row) throw appError("NOT_FOUND");
    const s = parseSession(row.session_id);
    const base = { ...s, run_state: null, paused: false, nodes: [] };
    if (!engine) return { engine: "not_configured", ...base };
    if (!s.run || !isRunId(s.run)) return { engine: "ok", ...base };
    try {
      const body = await engine.get(`/api/runs/${s.run}/nodes`);
      const state = typeof body.state === "string" ? body.state.slice(0, 40) : null;
      return {
        engine: "ok",
        ...s,
        run_state: state,
        paused: body.paused === true,
        nodes: toNodes(body.nodes),
      };
    } catch {
      return { engine: "unreachable", ...base };
    }
  }

  return { workspaces, process };
}
