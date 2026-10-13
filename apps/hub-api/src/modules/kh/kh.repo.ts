// HUB-FR-131 · spec K1 §3.2, §4 · plan §3.3, §5 (query → index) · câu SQL `hub.kh_connections` (+ đếm `agent_kh`, đọc
// `hub.secrets.kind/tenant_id/name`). Transaction + scope do service/`withConfigWrite` mở. Không bảng nào ở đây có RLS (nền
// tảng); route chỉ platform_admin. Không bao giờ đọc/ghi giá trị khoá — chỉ `secret_id` + tên secret.
import type { KhCheckResult, KhConnectionStatus } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { type SQL, sql } from "drizzle-orm";
import type { KhConnCursor, KhSecretRow } from "./kh.rules";

const iso = (v: Date | string): string => new Date(v).toISOString();

export type KhConnRow = {
  id: string;
  name: string;
  baseUrl: string;
  secretId: string;
  secretName: string;
  summaryProject: string | null;
  checkStatus: KhConnectionStatus;
  checkResult: KhCheckResult | null;
  agentsCount: number;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
};
type Raw = Omit<KhConnRow, "updatedAt" | "agentsCount" | "version"> & {
  updatedAt: Date | string;
  agentsCount: number | string;
  version: number | string;
};

// `agents_count` đếm qua `agent_kh_conn_idx`; tên secret qua PK `secrets`.
const VIEW = sql`select k.id, k.name, k.base_url as "baseUrl", k.secret_id as "secretId", s.name as "secretName",
  k.summary_project as "summaryProject", k.check_status as "checkStatus", k.check_result as "checkResult",
  (select count(*) from hub.agent_kh a where a.connection_id = k.id)::int as "agentsCount",
  k.version, k.updated_at as "updatedAt", u.username as "updatedBy"
  from hub.kh_connections k join hub.secrets s on s.id = k.secret_id
  left join admin.users u on u.id = k.updated_by`;

const toRow = (r: Raw): KhConnRow => ({
  ...r,
  agentsCount: Number(r.agentsCount),
  version: Number(r.version),
  updatedAt: iso(r.updatedAt),
});

/** Theo PK. `forUpdate` khoá hàng kết nối (không khoá secret/user). */
export async function readConn(
  tx: Tx,
  id: string,
  forUpdate = false,
): Promise<KhConnRow | undefined> {
  const lock = forUpdate ? sql` for update of k` : sql``;
  const [r] = await tx.execute<Raw>(sql`${VIEW} where k.id = ${id}::uuid${lock}`);
  return r ? toRow(r) : undefined;
}

/** Keyset `(lower(name), id) >` qua `kh_connections_name_uq`; trả `limit + 1` hàng để biết trang sau. */
export async function listConns(
  tx: Tx,
  a: { after?: KhConnCursor; limit: number },
): Promise<KhConnRow[]> {
  const where: SQL = a.after
    ? sql` where (lower(k.name), k.id) > (${a.after[0]}, ${a.after[1]}::uuid)`
    : sql``;
  const rows = await tx.execute<Raw>(
    sql`${VIEW}${where} order by lower(k.name), k.id limit ${a.limit + 1}`,
  );
  return rows.map(toRow);
}

export const cursorOf = (r: KhConnRow): KhConnCursor => [r.name.toLowerCase(), r.id];

/** Loại + phạm vi secret (Q29). Không đọc bản mã. */
export async function readSecretRef(tx: Tx, id: string): Promise<KhSecretRow | undefined> {
  const [r] = await tx.execute<{ kind: string; tenantId: string | null }>(
    sql`select kind, tenant_id as "tenantId" from hub.secrets where id = ${id}::uuid`,
  );
  return r;
}

/** Kết nối khác đang chiếm tên (lower) hoặc URL; tên được ưu tiên báo trước (Q15). */
export async function findClash(
  tx: Tx,
  a: { name: string; baseUrl: string; exceptId: string | null },
): Promise<{ id: string; field: "name" | "base_url" } | undefined> {
  const [r] = await tx.execute<{ id: string; nameHit: boolean }>(sql`select id,
      lower(name) = lower(${a.name}) as "nameHit" from hub.kh_connections
    where (lower(name) = lower(${a.name}) or base_url = ${a.baseUrl})
      and (${a.exceptId}::uuid is null or id <> ${a.exceptId}::uuid)
    order by 2 desc limit 1`);
  return r ? { id: r.id, field: r.nameHit ? "name" : "base_url" } : undefined;
}

export type ConnWrite = {
  name: string;
  baseUrl: string;
  secretId: string;
  summaryProject: string | null;
  actorId: string;
};

export async function insertConn(tx: Tx, id: string, w: ConnWrite): Promise<void> {
  await tx.execute(sql`insert into hub.kh_connections (id, name, base_url, secret_id, summary_project,
      created_by, updated_by)
    values (${id}::uuid, ${w.name}, ${w.baseUrl}, ${w.secretId}::uuid, ${w.summaryProject},
      ${w.actorId}::uuid, ${w.actorId}::uuid)`);
}

/** `version + 1`; `resetCheck` ⇒ cùng UPDATE đặt `unchecked`, xoá kết quả kiểm (D3, Q34). */
export async function updateConn(
  tx: Tx,
  id: string,
  w: ConnWrite & { resetCheck: boolean },
): Promise<void> {
  const reset = w.resetCheck
    ? sql`, check_status = 'unchecked', check_result = null, checked_at = null`
    : sql``;
  await tx.execute(sql`update hub.kh_connections set name = ${w.name}, base_url = ${w.baseUrl},
      secret_id = ${w.secretId}::uuid, summary_project = ${w.summaryProject}, version = version + 1,
      updated_at = now(), updated_by = ${w.actorId}::uuid${reset}
    where id = ${id}::uuid`);
}

/** Số agent đang tick kết nối (`agent_kh_conn_idx`). */
export async function countAgents(tx: Tx, id: string): Promise<number> {
  const [r] = await tx.execute<{ n: number | string }>(
    sql`select count(*)::int as n from hub.agent_kh where connection_id = ${id}::uuid`,
  );
  return Number(r?.n ?? 0);
}

const uuidArr = (ids: readonly string[]) => sql`${`{${ids.join(",")}}`}::uuid[]`;

/** HUB-FR-132 · id kết nối có thật trong `ids` (PK `kh_connections`). */
export async function existingConnIds(tx: Tx, ids: readonly string[]): Promise<Set<string>> {
  if (ids.length === 0) return new Set();
  const rows = await tx.execute<{ id: string }>(
    sql`select id from hub.kh_connections where id = any(${uuidArr(ids)})`,
  );
  return new Set(rows.map((r) => r.id));
}

/** HUB-FR-132 · thay toàn bộ `agent_kh` của agent; `position` = chỉ số trong `ids` (thứ tự tick). */
export async function replaceAgentKh(
  tx: Tx,
  agentId: string,
  ids: readonly string[],
): Promise<void> {
  await tx.execute(sql`delete from hub.agent_kh where agent_id = ${agentId}::uuid`);
  if (ids.length === 0) return;
  await tx.execute(sql`insert into hub.agent_kh (agent_id, connection_id, position)
    select ${agentId}::uuid, c, (o - 1)::smallint from unnest(${uuidArr(ids)}) with ordinality as u(c, o)`);
}

export async function deleteConn(tx: Tx, id: string): Promise<void> {
  await tx.execute(sql`delete from hub.kh_connections where id = ${id}::uuid`);
}

/** Lưu kết quả kiểm khi `version` chưa đổi (không tăng version). Trả số hàng đã cập nhật. */
export async function saveCheck(
  tx: Tx,
  a: { id: string; version: number; result: KhCheckResult },
): Promise<number> {
  const rows = await tx.execute(sql`update hub.kh_connections set check_status = ${a.result.status},
      check_result = ${JSON.stringify(a.result)}::jsonb, checked_at = ${a.result.checked_at}::timestamptz
    where id = ${a.id}::uuid and version = ${a.version} returning id`);
  return rows.length;
}

export async function usernameOf(tx: Tx, userId: string): Promise<string | null> {
  const [r] = await tx.execute<{ username: string }>(
    sql`select username from admin.users where id = ${userId}::uuid`,
  );
  return r?.username ?? null;
}
