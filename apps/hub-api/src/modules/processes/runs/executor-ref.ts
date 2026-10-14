// HUB-FR-105 · HUB-FR-116 · P-a D5 · tên hiển thị executor (agent/team) của stage cho view + tin thread.
// Snapshot chỉ giữ id executor (B5 không join mỗi lần xem); UAT thấy UUID → nạp tên từ catalog hub
// (`agents`/`agent_teams`.name theo locale), fallback key → id. Bảng catalog không RLS (0001) nên đọc được dưới
// mọi scope, kể cả platform_admin xem tenant khác. Không log nội dung.
import type { ExecutorRef } from "@ai/contracts/chat";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";

export type Executor =
  | { kind: "agent"; agent_id: string }
  | { kind: "team"; team_id: string }
  | { kind: "apply" };

type NameRow = { id: string; key: string; vi: string | null; en: string | null };

const NAME_MAX = 100; // = AgentNameSchema (contracts)
const clip = (s: string): string => (s.length > NAME_MAX ? s.slice(0, NAME_MAX) : s);
/** P-c2 · C19 · stage Áp không có agent/team ⇒ khoá cố định `apply`. */
export const idOf = (e: Executor): string =>
  e.kind === "agent" ? e.agent_id : e.kind === "team" ? e.team_id : "apply";

/** P-c2 · C19 · ExecutorRef cố định của stage Áp (Hub tự chạy, không catalog). */
export const APPLY_EXECUTOR_REF: ExecutorRef = {
  kind: "apply",
  key: "apply",
  name: { vi: "Áp bản sửa", en: "Apply the fix" },
};
const idsArr = (ids: readonly string[]) => sql.raw(`'{${ids.join(",")}}'::uuid[]`);

/** ExecutorRef từ hàng catalog (vi/en → key → id); key giữ id như cũ để FE khớp. */
const refOf = (kind: ExecutorRef["kind"], id: string, r?: NameRow): ExecutorRef => ({
  kind,
  key: id,
  name: { vi: clip(r?.vi || r?.key || id), en: clip(r?.en || r?.key || id) },
});

const agentNames = (tx: Tx, ids: readonly string[]) =>
  tx.execute<NameRow>(sql`select id, key, name->>'vi' as vi, name->>'en' as en
    from hub.agents where id = any(${idsArr(ids)})`);
const teamNames = (tx: Tx, ids: readonly string[]) =>
  tx.execute<NameRow>(sql`select id, key, name->>'vi' as vi, name->>'en' as en
    from hub.agent_teams where id = any(${idsArr(ids)})`);

/** Một executor (ghi tin thread cho một stage). */
export async function executorRefOf(tx: Tx, e: Executor): Promise<ExecutorRef> {
  if (e.kind === "apply") return APPLY_EXECUTOR_REF;
  const id = idOf(e);
  const [r] = e.kind === "agent" ? await agentNames(tx, [id]) : await teamNames(tx, [id]);
  return refOf(e.kind, id, r);
}

/** Nhiều executor (≤ 10 stage của một view) gộp 2 truy vấn; map id → ExecutorRef (mọi id có sẵn fallback id,
 * hàng DB ghi đè bằng tên thật). */
export async function resolveExecutors(
  tx: Tx,
  execs: readonly Executor[],
): Promise<Map<string, ExecutorRef>> {
  const map = new Map<string, ExecutorRef>();
  for (const e of execs)
    if (!map.has(idOf(e)))
      map.set(idOf(e), e.kind === "apply" ? APPLY_EXECUTOR_REF : refOf(e.kind, idOf(e)));
  const agentIds = [...new Set(execs.filter((e) => e.kind === "agent").map(idOf))];
  const teamIds = [...new Set(execs.filter((e) => e.kind === "team").map(idOf))];
  if (agentIds.length)
    for (const r of await agentNames(tx, agentIds)) map.set(r.id, refOf("agent", r.id, r));
  if (teamIds.length)
    for (const r of await teamNames(tx, teamIds)) map.set(r.id, refOf("team", r.id, r));
  return map;
}
