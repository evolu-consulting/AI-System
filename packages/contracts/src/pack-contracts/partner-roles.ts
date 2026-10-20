// V2-C · KN-08 · HD-10 · BA 5.6 · DT-05: contract zod của vai đối tác (NCC / khách / bên trả HH), gợi ý đối tác khi gõ tên trên HĐ
// và ghi chú đối tác (`/pack/contracts/partners/{roles,lookup,notes}`). Thân strict (khoá lạ ⇒ 400); khoá đối tác cấm NUL.
import { z } from "zod";
import type { ScoreBand } from "./partners";

export const PARTNER_ROLES_V2 = ["supplier", "customer", "commission_payer"] as const;
export type PartnerRoleV2 = (typeof PARTNER_ROLES_V2)[number];
/** Loại HĐ của BA v2 (§2): Mua / Bán / Giới thiệu. */
export const PARTNER_DEALS = ["buy", "sell", "referral"] as const;
export type PartnerDeal = (typeof PARTNER_DEALS)[number];
export const NEW_PARTNER_LABEL = "Đối tác mới · sẽ tạo khi lưu";

const noNul = (min: number, max: number) =>
  z
    .string()
    .min(min)
    .max(max)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" });
const Party = noNul(1, 300);

export const PartnerRolesQuerySchema = z.strictObject({ party: Party.optional() });
export const PartnerLookupQuerySchema = z.strictObject({
  name: noNul(1, 300).pipe(z.string().trim().min(1)),
  tax_id: noNul(0, 60).optional(),
  deal: z.enum(PARTNER_DEALS).optional(),
});
export const PartnerNotesQuerySchema = z.strictObject({ party: Party });
export const PartnerNoteCreateSchema = z.strictObject({
  party: Party,
  body: z
    .string()
    .trim()
    .normalize("NFC")
    .min(1)
    .max(2000)
    .refine((v) => !v.includes("\u0000"), { message: "NUL không được phép" }),
});
export type PartnerNoteCreate = z.infer<typeof PartnerNoteCreateSchema>;

// ---------- ra ----------
export type PartnerRoleRow = {
  party: string;
  role: PartnerRoleV2;
  name: string | null;
  created_from: "contract" | "backfill" | "manual";
  contract_id: string | null;
  first_at: string;
  /** Số việc đã ghi cho vai (bỏ việc huỷ, chấm tay). */
  events: number;
  min_events: number;
  /** BA 5.6d: MỚI tới khi đủ số việc tối thiểu. */
  is_new: boolean;
};
export type PartnerLookup =
  | {
      status: "existing";
      party: string;
      name: string | null;
      tax_id: string | null;
      roles: PartnerRoleV2[];
      role: PartnerRoleV2 | null;
      /** Vai của loại HĐ đã có chưa — chưa ⇒ thêm khi lưu (5.6c). */
      has_role: boolean;
      is_new: boolean;
      score: number | null;
      band: ScoreBand | null;
    }
  | { status: "new"; party: string; role: PartnerRoleV2 | null; label: string };
export type PartnerNote = {
  id: string;
  party: string;
  body: string;
  source: "manual" | "internet";
  by_user: string | null;
  by: string | null;
  at: string;
};
