// CR-097 K2 · UC-04 "so sánh" (decision 9): bảng diff trường pháp lý giữa hai phiên bản cùng chuỗi với HĐ `:id`. Lớp 2 — không SQL.
// CR-127 K5 · BR-36: `withText` ⇒ thêm điều khoản có nội dung đổi (văn bản trích `source_text`, tách theo "Điều N").
// MỘT tx, MỘT câu (repo). Bản không thấy (RLS) / khác chuỗi / tenant khác ⇒ null (404).
import type { PackUow, PackWho } from "../../kit/public";
import { type ClauseChange, diffClauses } from "../domain/clause-diff.rules";
import { CONTRACT_FIELD_KEYS } from "../domain/fields.rules";
import { diffFields, type FieldChange } from "../domain/versions.rules";

export type VersionFieldsRow = {
  id: string;
  version_no: number;
  fields: unknown;
  /** Chỉ khi `withText` (còn lại null). */
  source_text?: string | null;
};
export type VersionDiffRepo = {
  /** Hai bản `a`, `b` cùng chuỗi với `id` (thấy được); thiếu ⇒ ít hơn 2 hàng. `withText` ⇒ kèm văn bản trích. */
  pair(id: string, a: string, b: string, withText?: boolean): Promise<VersionFieldsRow[]>;
};

export type VersionDiff = {
  a: { id: string; version_no: number };
  b: { id: string; version_no: number };
  changes: FieldChange[];
  clauses?: ClauseChange[];
};

type FieldMap = Record<string, { value?: unknown } | null>;
export const asFieldMap = (v: unknown): FieldMap =>
  v && typeof v === "object" ? (v as FieldMap) : ({} as FieldMap);

export const versionDiff =
  (d: { uow: PackUow<{ versionDiff: VersionDiffRepo }> }) =>
  (who: PackWho, id: string, a: string, b: string, withText = false): Promise<VersionDiff | null> =>
    d.uow.tenant(who, async (r) => {
      const rows = await r.versionDiff.pair(id, a, b, withText);
      const ra = rows.find((x) => x.id === a);
      const rb = rows.find((x) => x.id === b);
      if (!ra || !rb) return null;
      return {
        a: { id: ra.id, version_no: ra.version_no },
        b: { id: rb.id, version_no: rb.version_no },
        changes: diffFields(asFieldMap(ra.fields), asFieldMap(rb.fields), CONTRACT_FIELD_KEYS),
        ...(withText
          ? {
              clauses: diffClauses(ra.source_text ?? null, rb.source_text ?? null).filter(
                (c) => c.changed,
              ),
            }
          : {}),
      };
    });
export type VersionDiffUsecase = ReturnType<typeof versionDiff>;
