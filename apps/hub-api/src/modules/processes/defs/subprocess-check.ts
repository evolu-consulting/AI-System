// CR-125 · «Quy trình con» — guard khi LƯU def (create/update, cùng tx ghi): mỗi bước `subprocess` trỏ quy trình CÓ THẬT của cùng công ty
// (bật, chưa xoá) hoặc quy trình Thư viện đã xuất bản ⇒ 422 `SUBPROCESS_NOT_FOUND`; đồ thị gọi từ def đang lưu quay về chính nó ⇒
// `SUBPROCESS_CYCLE`; dài hơn `SUBPROCESS_DEPTH_MAX` cạnh ⇒ `SUBPROCESS_DEPTH`. `details` = `{ path, def_key, chain? }` (web dịch theo mã).
// Số câu theo TẦNG (≤ độ sâu + 1), không theo số bước: mỗi tầng một câu `key = any(…)`.
import {
  type HubAdminSubprocessErrorCode,
  type ProcessDefInput,
  SUBPROCESS_DEPTH_MAX,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { callIssue } from "../domain/runs/subprocess.rules";
import { defError } from "./defs.map";

type Row = { key: string; stages: unknown };

const subKeysOf = (stages: unknown): string[] =>
  Array.isArray(stages)
    ? stages.flatMap((s) => {
        const ex = (s as { executor?: { kind?: string; def_key?: unknown } } | null)?.executor;
        return ex?.kind === "subprocess" && typeof ex.def_key === "string" ? [ex.def_key] : [];
      })
    : [];

/** Def gọi được theo khoá: công ty (bật, chưa xoá) hoặc Thư viện đã xuất bản; def Thư viện chỉ gọi def Thư viện. */
async function callable(tx: Tx, tenantId: string | null, keys: readonly string[]): Promise<Row[]> {
  if (keys.length === 0) return [];
  const ks = JSON.stringify([...new Set(keys)]);
  return tx.execute<Row>(sql`select distinct on (key) key, stages from hub.process_defs
    where key in (select jsonb_array_elements_text(${ks}::jsonb)) and deleted_at is null
      and ((${tenantId}::uuid is not null and tenant_id = ${tenantId}::uuid and enabled)
        or (tenant_id is null and published_version is not null))
    order by key, (tenant_id is null), created_at desc`);
}

const fail = (code: HubAdminSubprocessErrorCode, details: Record<string, unknown>) =>
  defError(code, details);

export async function subprocessCheck(
  tx: Tx,
  tenantId: string | null,
  input: ProcessDefInput,
): Promise<void> {
  const own = subKeysOf(input.stages);
  if (own.length === 0) return;
  const pathOf = (k: string) =>
    `stages.${input.stages.findIndex((s) => (s.executor as { def_key?: string }).def_key === k)}.executor.def_key`;
  const edges = new Map<string, string[]>([[input.key, own]]);
  let level = own.filter((k) => k !== input.key);
  const first = await callable(tx, tenantId, level);
  const found = new Set(first.map((r) => r.key));
  const miss = level.find((k) => !found.has(k));
  if (miss) throw fail("SUBPROCESS_NOT_FOUND", { path: pathOf(miss), def_key: miss });
  let rows = first;
  for (let depth = 1; depth <= SUBPROCESS_DEPTH_MAX && rows.length > 0; depth++) {
    for (const r of rows) edges.set(r.key, subKeysOf(r.stages));
    level = rows.flatMap((r) => edges.get(r.key) ?? []).filter((k) => !edges.has(k));
    rows = await callable(tx, tenantId, level);
  }
  const issue = callIssue(input.key, edges, SUBPROCESS_DEPTH_MAX);
  if (!issue) return;
  const k = issue.chain[1] ?? input.key;
  throw fail(issue.kind === "cycle" ? "SUBPROCESS_CYCLE" : "SUBPROCESS_DEPTH", {
    path: pathOf(k),
    def_key: k,
    chain: issue.chain,
  });
}
