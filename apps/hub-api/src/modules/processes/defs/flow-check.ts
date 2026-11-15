// CR-122 · E1 / CR-127 · E6b (tách khỏi defs.service.ts cho ≤ 400 dòng): luật FlowDef khi lưu def có `trigger`.
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { sql } from "drizzle-orm";
import { claimError } from "../core/errors";
import { triggerCoreFactPaths } from "../domain/if/core-facts.rules";
import { triggerParamIssue } from "../triggers/schedule.rules";
import { defError } from "./defs.map";
import type * as repo from "./defs.repo";
import { flowDefPaths } from "./flow-def.rules";

/** CR-122 · E1 · def có `trigger` ⇒ luật FlowDef (422 `PROCESS_DEF_INVALID`, `paths`). */
export async function flowCheck(
  tx: Tx,
  input: ProcessDefInput,
  tenantId: string | null,
  cur: repo.DefRow | null,
): Promise<void> {
  const range = triggerParamIssue(input.trigger); // CR-127 · E6b · N ngày ngoài khoảng manifest ⇒ 422
  if (range) throw claimError("TRIGGER_PARAM_RANGE", range);
  // CR-160 · «Bắt đầu khi» dùng dữ kiện lõi (`starter_is_top`) sẽ không bao giờ khớp ⇒ 422 rõ, không để quy trình im lặng không chạy
  const core = triggerCoreFactPaths(input.trigger?.when);
  if (core.length > 0) throw claimError("TRIGGER_FACT_CORE", { paths: core });
  const paths = flowDefPaths(input, tenantId, cur);
  if (paths.length > 0) throw defError("PROCESS_DEF_INVALID", { paths });
  await receiveOwnerCheck(tx, tenantId, input);
}

/** Đường lỗi của người phụ trách HĐ nhận (422 theo trường). */
export const RECEIVE_OWNER_PATH = "trigger.params.owner_user_id";

/**
 * fix-review-r2 · quy trình công ty «Nhận HĐ từ đối tác» (`contract.received`) có `trigger.params.owner_user_id` ⇒ người đó phải thuộc công ty,
 * nội bộ (`kind='internal'`), đang hoạt động, không bị khoá — MỘT câu `exists`, tenant tường minh. Chỉ kiểm khi lần lưu này gửi `trigger`
 * (lưu phần khác không bị chặn vì người phụ trách cũ vừa nghỉ). Lúc nhận HĐ, người đã không còn dùng được ⇒ `owner_user_id = null` (xem `receiveOwnerOf`).
 */
export async function receiveOwnerCheck(
  tx: Tx,
  tenantId: string | null,
  input: ProcessDefInput,
): Promise<void> {
  const t = input.trigger;
  const owner = t?.event === "contract.received" ? t.params?.owner_user_id : undefined;
  if (tenantId === null || owner === undefined) return;
  const [r] = await tx.execute<{ ok: boolean }>(sql`select exists (select 1 from admin.users u
    where u.id = ${owner}::uuid and u.tenant_id = ${tenantId}::uuid and u.kind = 'internal' and u.active and not u.locked_by_tenant) as ok`);
  if (r?.ok !== true) throw defError("PROCESS_DEF_INVALID", { paths: [RECEIVE_OWNER_PATH] });
}

/**
 * fix-review-r3 · MỘT cổng kiểm cho mọi đường lưu def: `flowRules` (đường thường) ⇒ luật FlowDef (kèm người phụ trách);
 * đường khe / bản sao thư viện (không áp luật FlowDef) ⇒ vẫn kiểm người phụ trách nhận HĐ.
 */
export async function checkOnSave(
  tx: Tx,
  input: ProcessDefInput,
  tenantId: string | null,
  cur: repo.DefRow | null,
  flowRules: boolean,
): Promise<void> {
  if (flowRules) await flowCheck(tx, input, tenantId, cur);
  else await receiveOwnerCheck(tx, tenantId, input);
}
