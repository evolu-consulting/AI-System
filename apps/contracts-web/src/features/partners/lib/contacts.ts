// GAP-D2 · #24: luật thuần của form "Người liên hệ" — dòng nháp ↔ thân PUT (bỏ dòng trống, tên bắt buộc khi dòng có chữ, ≤ 20 người).
import type { PartnerContactPerson } from "@ai/contracts";
import type { PartnerContactDraft } from "../api";

export const CONTACTS_MAX = 20;
export type ContactRow = {
  key: string;
  name: string;
  role: string;
  phone: string;
  email: string;
  our_owner: string;
};

let seq = 0;
export const blankRow = (): ContactRow => ({
  key: `n${++seq}`,
  name: "",
  role: "",
  phone: "",
  email: "",
  our_owner: "",
});

export const rowsOf = (cs: readonly PartnerContactPerson[] | undefined): ContactRow[] =>
  (cs ?? []).map((c) => ({
    key: c.id,
    name: c.name,
    role: c.role ?? "",
    phone: c.phone ?? "",
    email: c.email ?? "",
    our_owner: c.our_owner ?? "",
  }));

const orNull = (v: string): string | null => (v.trim() === "" ? null : v.trim());
const filled = (r: ContactRow) =>
  [r.name, r.role, r.phone, r.email, r.our_owner].some((v) => v.trim() !== "");

/** Dòng nháp ⇒ thân PUT; dòng không có chữ bị bỏ; dòng có chữ mà thiếu tên ⇒ `missing_name` (chỉ số dòng). */
export function draftsOf(
  rows: readonly ContactRow[],
): { ok: PartnerContactDraft[] } | { err: "missing_name" | "too_many"; at: number } {
  const used = rows.filter(filled);
  if (used.length > CONTACTS_MAX) return { err: "too_many", at: CONTACTS_MAX };
  const bad = used.findIndex((r) => r.name.trim() === "");
  if (bad >= 0) return { err: "missing_name", at: bad };
  return {
    ok: used.map((r) => ({
      name: r.name.trim(),
      role: orNull(r.role),
      phone: orNull(r.phone),
      email: orNull(r.email),
      our_owner: orNull(r.our_owner),
    })),
  };
}
