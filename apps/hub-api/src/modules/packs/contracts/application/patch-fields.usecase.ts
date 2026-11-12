// HD-FR-02 · HD-FR-06 · HD-AC06 · HD-AC01 · D-13 · HD1 plan §5 §6: sửa tay trường HĐ — MỘT tx `PackUow` (role `contracts_rw`,
// RLS FORCE): ① `set_config` ② `SELECT … FOR UPDATE` một hàng (0 hàng ⇒ not_found = 404 giống id lạ; `version` lệch ⇒ stale = 409)
// ③ `applyEdits` trong RAM (giá trị y cũ ⇒ không đổi, trả bản hiện tại, không tăng version, không ghi) ④ một CTE UPDATE + INSERT
// event `field_edited` ⑤ outbox `{contract, upsert}` = 4 câu cố định. Khoá `edited` giữ khi trích lại (`mergeFields`, HD2).
// CR-127 K4 · BR-39: HĐ PROCESSING / DONE ⇒ nội dung khoá cho mọi người (`lockVerdict`) ⇒ 409 `CONTRACT_LOCKED` ("tải phiên bản mới để sửa");
// bỏ "sửa khi đang duyệt" (`approval-edit.rules`, seam `patchGuard`) và "Mở lại".
import type { KitTxRepos, PackUow, PackWho } from "../../kit/public";
import {
  applyEdits,
  type ContractFieldKey,
  type ContractFields,
  type FieldChange,
  type FieldValue,
} from "../domain/fields.rules";
import { lockVerdict } from "../domain/lock.rules";

/** Hàng đã khoá: `fields` thô (jsonb) — `applyEdits` lấp đủ 23 khoá. */
export type LockedContract = {
  version: number;
  updated_at: string;
  fields: unknown;
  /** CR-127 K4 · trạng thái HĐ (khoá nội dung khi processing/done). */
  status: string;
  /** Giao dịch (`deal`) không thuộc khoá K4. */
  doc_type?: string;
};
export type SavedContract = { version: number; updated_at: string };

/** Cổng ghi trường: mỗi hàm = MỘT câu SQL trong tx của `PackUow`. */
export type ContractFieldsRepo = {
  /** `SELECT version, updated_at, fields … FOR UPDATE` theo PK + `tenant_id`; không có / tenant khác ⇒ `null`. */
  lock(id: string): Promise<LockedContract | null>;
  /** CTE: UPDATE `fields`, `version+1`, `updated_at=now()` (điều kiện `version = expected`) + INSERT event `field_edited`. */
  save(
    id: string,
    s: { fields: ContractFields; changes: FieldChange[]; expected: number; actor: string },
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
  | { kind: "locked" };

export type PatchFields = (
  who: PackWho,
  id: string,
  input: PatchFieldsInput,
) => Promise<PatchFieldsResult>;

type Deps = { uow: PackUow<KitTxRepos & { fields: ContractFieldsRepo }> };

type Tx = KitTxRepos & { fields: ContractFieldsRepo };

/** Phần trong tx: khoá hàng → kiểm version → sửa trong RAM → luật khoá nội dung → ghi. */
async function applyPatch(
  r: Tx,
  q: { who: PackWho; id: string; input: PatchFieldsInput },
): Promise<PatchFieldsResult> {
  const { who, id, input } = q;
  const cur = await r.fields.lock(id);
  if (!cur) return { kind: "not_found" };
  if (cur.version !== input.version)
    return { kind: "stale", current: { version: cur.version }, updated_at: cur.updated_at };
  const { fields, changes } = applyEdits(cur.fields, input.fields);
  if (changes.length === 0)
    return { kind: "ok", out: { id, version: cur.version, updated_at: cur.updated_at, fields } };
  const changed = changes.map((c) => c.key);
  if (lockVerdict({ status: cur.status, docType: cur.doc_type, changed }) === "locked")
    return { kind: "locked" };
  const saved = await r.fields.save(id, {
    fields,
    changes,
    expected: cur.version,
    actor: who.userId,
  });
  await r.outbox.enqueue([{ entity: "contract", entity_id: id, op: "upsert" }]);
  return { kind: "ok", out: { id, ...saved, fields } };
}

export function patchFields(d: Deps): PatchFields {
  return (who, id, input) => d.uow.tenant(who, (r) => applyPatch(r, { who, id, input }));
}
