// HUB-FR-45 · Drizzle query `hub.flows`, `hub.messages`, `hub.runs`, `hub.run_steps` cho E10/E11 (plan H1 §3.2).
// Gọi trong `withHubScope(user)`; lọc `tenant_id` + `user_id` tường minh như conversations.repo.
import type { Tx } from "@ai/db";
import { agents, flows, messages, modelProfiles, runSteps, runs } from "@ai/db/schema/hub";
import { and, asc, desc, eq, inArray, type SQL, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import type { Owner } from "./conversations.repo";
import { keyAt } from "./conversations.repo";
import type { Locale, MessageRow, PageKey, RunRow, StepRow, StepType } from "./conversations.rules";

export type FlowRow = {
  id: string;
  conversationId: string;
  title: string;
  createdAt: Date;
  lastActiveAt: Date;
  messageCount: number;
  activeRunId: string | null;
  key: PageKey;
};

const f = flows;
const m = messages;
const ownedBy = (t: { tenantId: AnyPgColumn; userId: AnyPgColumn }, o: Owner): SQL =>
  and(eq(t.tenantId, o.tenantId), eq(t.userId, o.userId)) as SQL;

// Bí danh tường minh: Drizzle in cột trong sql`` không kèm tên bảng nên câu con tương quan sẽ trỏ nhầm bảng.
const activeRun = sql<string | null>`(select r.id from hub.runs r
  where r.flow_id = "flows"."id" and r.status = 'running' limit 1)`;

/** E10 · flow của hội thoại, `created_at` tăng (CR-051: `desc` ⇒ giảm, cursor = trang cũ hơn); index `flows_conversation_idx`; đọc `limit + 1`. */
export async function listFlows(
  tx: Tx,
  o: Owner,
  p: { conversationId: string; after?: PageKey; limit: number; desc?: boolean },
): Promise<FlowRow[]> {
  const conds: SQL[] = [ownedBy(f, o), eq(f.conversationId, p.conversationId)];
  if (p.after) {
    const cmp = p.desc ? sql`<` : sql`>`;
    conds.push(
      sql`(${f.createdAt}, ${f.id}) ${cmp} (${p.after[0]}::timestamptz, ${p.after[1]}::uuid)`,
    );
  }
  const rows = await tx
    .select({
      id: f.id,
      conversationId: f.conversationId,
      title: f.title,
      createdAt: f.createdAt,
      lastActiveAt: f.lastActiveAt,
      messageCount: f.messageCount,
      activeRunId: activeRun,
      at: keyAt(f.createdAt),
    })
    .from(f)
    .where(and(...conds))
    .orderBy(...(p.desc ? [desc(f.createdAt), desc(f.id)] : [asc(f.createdAt), asc(f.id)]))
    .limit(p.limit + 1);
  return rows.map(({ at, ...r }) => ({ ...r, key: [at, r.id] as const }));
}

export async function flowInConversation(
  tx: Tx,
  o: Owner,
  conversationId: string,
  flowId: string,
): Promise<boolean> {
  const rows = await tx
    .select({ id: f.id })
    .from(f)
    .where(and(ownedBy(f, o), eq(f.id, flowId), eq(f.conversationId, conversationId)));
  return rows.length > 0;
}

const msgCols = {
  id: m.id,
  conversationId: m.conversationId,
  flowId: m.flowId,
  role: m.role,
  content: m.content,
  runId: m.runId,
  ask: m.ask,
  createdAt: m.createdAt,
};

/** Tin đầu mỗi vai của từng flow (preview E10): `DISTINCT ON (flow_id, role)` theo `created_at, id` tăng. */
export async function firstMessages(tx: Tx, o: Owner, flowIds: string[]): Promise<MessageRow[]> {
  if (flowIds.length === 0) return [];
  return tx
    .selectDistinctOn([m.flowId, m.role], msgCols)
    .from(m)
    .where(and(ownedBy(m, o), inArray(m.flowId, flowIds)))
    .orderBy(m.flowId, m.role, asc(m.createdAt), asc(m.id));
}

/** E11 · tin mới nhất trước (`created_at, id` giảm, đọc `limit + 1`); service đảo lại thành tăng. */
export async function listMessagesDesc(
  tx: Tx,
  o: Owner,
  p: { conversationId: string; flowId?: string; before?: PageKey; limit: number },
): Promise<(MessageRow & { key: PageKey })[]> {
  const conds: SQL[] = [ownedBy(m, o), eq(m.conversationId, p.conversationId)];
  if (p.flowId) conds.push(eq(m.flowId, p.flowId));
  if (p.before) {
    conds.push(
      sql`(${m.createdAt}, ${m.id}) < (${p.before[0]}::timestamptz, ${p.before[1]}::uuid)`,
    );
  }
  const rows = await tx
    .select({ ...msgCols, at: keyAt(m.createdAt) })
    .from(m)
    .where(and(...conds))
    .orderBy(desc(m.createdAt), desc(m.id))
    .limit(p.limit + 1);
  return rows.map(({ at, ...r }) => ({ ...r, key: [at, r.id] as const }));
}

// CR-054 · agent của bước (tên + model hiện hành của agent: riêng ?? bước 0 profile) cho phần "Quá trình".
function stepsOf(tx: Tx, o: Owner, runIds: string[]) {
  return tx
    .select({
      runId: runSteps.runId,
      seq: runSteps.seq,
      type: runSteps.type,
      status: runSteps.status,
      startedAt: runSteps.startedAt,
      finishedAt: runSteps.finishedAt,
      agentKey: agents.key,
      agentName: agents.name,
      agentModel: sql<
        string | null
      >`coalesce(${agents.model}, ${modelProfiles.steps} -> 0 ->> 'model')`,
    })
    .from(runSteps)
    .leftJoin(agents, eq(agents.id, runSteps.agentId))
    .leftJoin(modelProfiles, eq(modelProfiles.id, agents.profileId))
    .where(and(ownedBy(runSteps, o), inArray(runSteps.runId, runIds)));
}

/** Run + step của các run gắn với tin assistant (tóm tắt `Message.run`). */
export async function runsWithSteps(
  tx: Tx,
  o: Owner,
  runIds: string[],
): Promise<{ runs: RunRow[]; steps: StepRow[] }> {
  if (runIds.length === 0) return { runs: [], steps: [] };
  const runRows = await tx
    .select({
      id: runs.id,
      status: runs.status,
      locale: runs.locale,
      startedAt: runs.startedAt,
      finishedAt: runs.finishedAt,
      errorCode: runs.errorCode,
      errorMessage: runs.errorMessage,
      errorHint: runs.errorHint,
      responderKey: runs.responderKey,
      responderName: runs.responderName,
    })
    .from(runs)
    .where(and(ownedBy(runs, o), inArray(runs.id, runIds)));
  const stepRows = await stepsOf(tx, o, runIds);
  return {
    runs: runRows.map(({ responderKey, responderName, ...r }) => ({
      ...r,
      locale: r.locale as Locale,
      responder: responderKey && responderName ? { key: responderKey, name: responderName } : null,
    })),
    steps: stepRows.map(({ agentKey, agentName, agentModel, ...s }) => ({
      ...s,
      type: s.type as StepType,
      agent: agentKey && agentName ? { key: agentKey, name: agentName, model: agentModel } : null,
    })),
  };
}
