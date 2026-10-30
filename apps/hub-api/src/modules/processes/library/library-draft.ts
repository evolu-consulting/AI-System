// CR-105 · L2a · design §5: lưu nháp def thư viện. Nguồn thật = `slot_body` (Form, Group theo mã); `stages` = `SlotSpec.compile(body)`
// Hub biên dịch lại mỗi lần lưu (gửi cả hai ⇒ `slot_body` thắng). Chỉ `stages` (canvas) ⇒ `SlotSpec.fromStages` dựng lại body (dạng
// khác ⇒ 422 `SLOT_SHAPE_UNSUPPORTED {stage}`); khe không có `fromStages` ⇒ chỉ nhận stages y như nháp. Kèm luật "đang dùng" (409 PROCESS_IN_USE).
import {
  HUB_ADMIN_LIBRARY_ERRORS,
  type HubAdminLibraryErrorCode,
  type ProcessDefInput,
} from "@ai/contracts/hub-admin";
import type { Tx } from "@ai/db";
import { AppError } from "../../../lib/errors";
import type { PackToolCatalog } from "../../packs/kit/application/pack-tools.ports";
import type { DefRefs } from "../defs/def-refs";
import { loadDefRefs } from "../defs/teams.repo";
import type { ToolDefShape } from "../domain/defs/tool-def.rules";
import { usage } from "./library.repo";
import { type SlotSpec, slotSpecOf } from "./slots";

const MESSAGES: Record<HubAdminLibraryErrorCode, string> = {
  PROCESS_IN_USE: "Process is assigned to a tenant or is a slot default",
  PROCESS_NOT_PUBLISHED: "Process has no published release",
  PROCESS_PUBLISH_INVALID: "Process cannot be published",
  SLOT_GROUPS_MISSING: "Tenant lacks groups required by the process",
  SLOT_UNKNOWN: "Unknown process slot",
  SLOT_BODY_INVALID: "Invalid slot body",
  SLOT_SHAPE_UNSUPPORTED: "Stages cannot be represented by the slot",
};

export function libError(code: HubAdminLibraryErrorCode, details?: unknown): AppError {
  return new AppError(code, HUB_ADMIN_LIBRARY_ERRORS[code], MESSAGES[code], details);
}

export function specOrThrow(slot: string): SlotSpec {
  const spec = slotSpecOf(slot);
  if (!spec) throw libError("SLOT_UNKNOWN", { slot });
  return spec;
}

type Cur = { stages: unknown[]; slot_body: unknown } | null;

/** So stage bỏ qua thứ tự khoá + trường rỗng (null / [] — mặc định zod/chuẩn hoá đọc) để canvas gửi lại y nguyên được nhận. */
function canon(x: unknown): unknown {
  if (Array.isArray(x)) return x.map(canon);
  if (typeof x !== "object" || x === null) return x;
  const keep = Object.entries(x).filter(
    ([, v]) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
  );
  return Object.fromEntries(
    keep.sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => [k, canon(v)]),
  );
}

/** Body ⇒ (kiểm luật khe) ⇒ stages biên dịch. Trả input với `stages` của Hub + body để ghi. */
export function slotDraft(
  spec: SlotSpec,
  input: ProcessDefInput,
  cur: Cur,
): { input: ProcessDefInput; body: unknown } {
  let body = input.slot_body;
  if (body === undefined && spec.fromStages) {
    // Canvas: dựng lại body từ stages (dạng tuần tự của khe); song song / If / nhánh ⇒ 422 kèm stage sai.
    const r = spec.fromStages(input.stages);
    if ("stage" in r) throw libError("SLOT_SHAPE_UNSUPPORTED", { stage: r.stage, slot: spec.key });
    body = r.body;
  }
  if (body === undefined) {
    const same =
      cur !== null && JSON.stringify(canon(cur.stages)) === JSON.stringify(canon(input.stages));
    if (!same) throw libError("SLOT_SHAPE_UNSUPPORTED", { stage: null, slot: spec.key });
    body = cur.slot_body;
  }
  const issues = spec.validate(body);
  if (issues.length) throw libError("SLOT_BODY_INVALID", { issues: issues.slice(0, 20) });
  const stages = spec.compile(body) as ProcessDefInput["stages"];
  return { input: { ...input, stages, run_group_ids: [] }, body };
}

/** Tham chiếu để kiểm def thư viện: agent/nhóm bật (như mẫu) + tool hệ thống của gói khe từ catalog (không theo tenant). */
export async function libraryRefs(
  tx: Tx,
  stages: ProcessDefInput["stages"],
  packs?: PackToolCatalog,
): Promise<DefRefs> {
  const base = await loadDefRefs(tx, null);
  const tools = new Map<string, ToolDefShape>();
  for (const s of stages) {
    const k = s.executor.kind === "tool" ? s.executor.tool_key : undefined;
    const info = k ? packs?.info(k) : undefined;
    if (k && info) tools.set(k, info);
  }
  return { ...base, tools };
}

/** Def thư viện đang gán / là mặc định ⇒ cấm xoá, tắt, đổi key, đổi khe (409). Đổi khe của def đã xuất bản cũng cấm. */
export async function guardInUse(
  tx: Tx,
  cur: { id: string; key: string; slot: string | null; published_version: number | null },
  next: { key: string; slot: string | null; enabled: boolean } | "delete",
): Promise<void> {
  if (cur.slot === null) return;
  const slotChange = next !== "delete" && next.slot !== cur.slot;
  if (slotChange && cur.published_version !== null)
    throw libError("PROCESS_IN_USE", { tenant_count: 0, is_default: false });
  const risky = next === "delete" || !next.enabled || next.key !== cur.key || slotChange;
  if (!risky) return;
  const u = await usage(tx, cur.id);
  if (u.tenant_count > 0 || u.is_default) throw libError("PROCESS_IN_USE", u);
}
