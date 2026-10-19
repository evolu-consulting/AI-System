// HD-FR-02 · HD-FR-06 · HD-AC06 · HD-AC01 · D-13 · HD1 plan §5 §6: sửa tay trường HĐ — MỘT tx `PackUow` (role `contracts_rw`,
// RLS FORCE): ① `set_config` ② `SELECT … FOR UPDATE` một hàng (0 hàng ⇒ not_found = 404 giống id lạ; `version` lệch ⇒ stale = 409)
// ③ `applyEdits` trong RAM (giá trị y cũ ⇒ không đổi, trả bản hiện tại, không tăng version, không ghi) ④ một CTE UPDATE + INSERT
// event `field_edited` ⑤ outbox `{contract, upsert}` = 4 câu cố định. Khoá `edited` giữ khi trích lại (`mergeFields`, HD2).
// Review HD3 S1: luật `editVerdict` — trường rẽ nhánh khi HĐ đang qua duyệt sau cấp 1 ⇒ 409 `CONTRACT_IN_APPROVAL` (hỏi engine
// giai đoạn run chỉ khi cần, +1 câu hub); trường tiền của HĐ đã duyệt ⇒ chính sách (mặc định 409 `CONTRACT_LOCKED`).
import type { KitTxRepos } from "../../kit/application/index-outbox";
import type { PackUow, PackWho } from "../../kit/application/ports";
import {
  type ApprovalEditPolicy,
  DEFAULT_EDIT_POLICY,
  editVerdict,
  needsRunPhase,
  type RunPhase,
} from "../domain/approval-edit.rules";
import {
  applyEdits,
  type ContractFieldKey,
  type ContractFields,
  type FieldChange,
  type FieldValue,
} from "../domain/fields.rules";

/** Hàng đã khoá: `fields` thô (jsonb) — `applyEdits` lấp đủ 23 khoá. */
export type LockedContract = {
  version: number;
  updated_at: string;
  fields: unknown;
  /** HD3 · vắng (fake cũ) ⇒ coi như không trong flow. */
  status?: string;
  run_id?: string | null;
};
export type SavedContract = { version: number; updated_at: string };

/** Cổng ghi trường: mỗi hàm = MỘT câu SQL trong tx của `PackUow`. */
export type ContractFieldsRepo = {
  /** `SELECT version, updated_at, fields … FOR UPDATE` theo PK + `tenant_id`; không có / tenant khác ⇒ `null`. */
  lock(id: string): Promise<LockedContract | null>;
  /** CTE: UPDATE `fields`, `version+1`, `updated_at=now()` (điều kiện `version = expected`) + INSERT event `field_edited`. */
  save(
    id: string,
    s: {
      fields: ContractFields;
      changes: FieldChange[];
      expected: number;
      actor: string;
      /** HD3 D3-13 · cùng câu: `needs_review`, bỏ `confirmed_*`, gỡ `run_id`; event `field_edited` có `approval_reopened`. */
      reopen?: boolean;
    },
  ): Promise<SavedContract>;
};

export type PatchFieldsInput = {
  version: number;
  fields: Partial<Record<ContractFieldKey, FieldValue>>;
};
export type PatchFieldsOk = {
  id: string;
  version: number;
  updated_at: string;
  fields: ContractFields;
};
export type PatchFieldsResult =
  | { kind: "ok"; out: PatchFieldsOk }
  | { kind: "not_found" }
  | { kind: "stale"; current: { version: number }; updated_at: string }
  | { kind: "in_approval" | "locked" };

/** HD3 · seam duyệt: giai đoạn run (engine) + chính sách + mở lại duyệt; vắng ⇒ hành vi HD1. */
export type PatchApprovalGuard = {
  phase(who: PackWho, runId: string): Promise<RunPhase>;
  policy?: ApprovalEditPolicy;
  /** Chính sách `reopen`: mở run duyệt mới sau COMMIT. */
  restart?(who: PackWho, id: string): Promise<void>;
};

export type PatchFields = (
  who: PackWho,
  id: string,
  input: PatchFieldsInput,
) => Promise<PatchFieldsResult>;

type Deps = {
  uow: PackUow<KitTxRepos & { fields: ContractFieldsRepo }>;
  approval?: PatchApprovalGuard;
};

/** S1 · phán quyết sửa theo trạng thái + giai đoạn run (hỏi engine chỉ khi đổi trường rẽ nhánh trong flow). */
async function verdictOf(d: Deps, who: PackWho, cur: LockedContract, changed: string[]) {
  if (!d.approval || !cur.status) return "ok";
  const status = cur.status;
  const run = cur.run_id ?? null;
  const phase =
    run && needsRunPhase(status, true, changed) ? await d.approval.phase(who, run) : "none";
  return editVerdict({ status, changed, phase, policy: d.approval.policy ?? DEFAULT_EDIT_POLICY });
}

type Tx = KitTxRepos & { fields: ContractFieldsRepo };

/** Phần trong tx: khoá → kiểm version → sửa trong RAM → luật duyệt → ghi (mở lại duyệt cùng câu nếu D3-13). */
async function applyPatch(
  d: Deps,
  r: Tx,
  q: { who: PackWho; id: string; input: PatchFieldsInput },
): Promise<{ res: PatchFieldsResult; reopened: boolean }> {
  const { who, id, input } = q;
  const cur = await r.fields.lock(id);
  if (!cur) return { res: { kind: "not_found" }, reopened: false };
  if (cur.version !== input.version) {
    const res = {
      kind: "stale" as const,
      current: { version: cur.version },
      updated_at: cur.updated_at,
    };
    return { res, reopened: false };
  }
  const { fields, changes } = applyEdits(cur.fields, input.fields);
  if (changes.length === 0) {
    const out = { id, version: cur.version, updated_at: cur.updated_at, fields };
    return { res: { kind: "ok", out }, reopened: false };
  }
  const verdict = await verdictOf(
    d,
    who,
    cur,
    changes.map((c) => c.key),
  );
  if (verdict === "in_approval" || verdict === "locked")
    return { res: { kind: verdict }, reopened: false };
  const reopened = verdict === "reopen";
  const s = { fields, changes, expected: cur.version, actor: who.userId };
  const saved = await r.fields.save(id, reopened ? { ...s, reopen: true } : s);
  await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
  return { res: { kind: "ok", out: { id, ...saved, fields } }, reopened };
}

export function patchFields(d: Deps): PatchFields {
  return async (who, id, input) => {
    const { res, reopened } = await d.uow.tenant(who, (r) => applyPatch(d, r, { who, id, input }));
    // D3-13 · run duyệt mới SAU COMMIT (giá trị mới đã ghi).
    if (reopened) await d.approval?.restart?.(who, id);
    return res;
  };
}
