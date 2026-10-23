// CR-097 K2 · UC-04 "so sánh" (decision 9): bảng diff trường pháp lý giữa hai phiên bản cùng chuỗi với HĐ `:id`. Lớp 2 — không SQL.
// MỘT tx, MỘT câu (repo). Bản không thấy (RLS) / khác chuỗi / tenant khác ⇒ null (404).
import type { PackUow, PackWho } from "../../kit/application/ports";
import { CONTRACT_FIELD_KEYS } from "../domain/fields.rules";
import { diffFields, type FieldChange } from "../domain/versions.rules";

export type VersionFieldsRow = { id: string; version_no: number; fields: unknown };
export type VersionDiffRepo = {
  /** Hai bản `a`, `b` cùng chuỗi với `id` (thấy được); thiếu ⇒ ít hơn 2 hàng. */
  pair(id: string, a: string, b: string): Promise<VersionFieldsRow[]>;
};

export type VersionDiff = {
  a: { id: string; version_no: number };
  b: { id: string; version_no: number };
  changes: FieldChange[];
};

type FieldMap = Record<string, { value?: unknown } | null>;
const asMap = (v: unknown): FieldMap =>
  v && typeof v === "object" ? (v as FieldMap) : ({} as FieldMap);

export const versionDiff =
  (d: { uow: PackUow<{ versionDiff: VersionDiffRepo }> }) =>
  (who: PackWho, id: string, a: string, b: string): Promise<VersionDiff | null> =>
    d.uow.tenant(who, async (r) => {
      const rows = await r.versionDiff.pair(id, a, b);
      const ra = rows.find((x) => x.id === a);
      const rb = rows.find((x) => x.id === b);
      if (!ra || !rb) return null;
      return {
        a: { id: ra.id, version_no: ra.version_no },
        b: { id: rb.id, version_no: rb.version_no },
        changes: diffFields(asMap(ra.fields), asMap(rb.fields), CONTRACT_FIELD_KEYS),
      };
    });
export type VersionDiffUsecase = ReturnType<typeof versionDiff>;
