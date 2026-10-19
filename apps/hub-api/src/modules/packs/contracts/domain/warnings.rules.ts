// HD-FR-23 · HD-FR-25: cảnh báo luật của bản trích (port `R/api/app/contracts/verify.py:76-140`) + định dạng MST
// (`companies/registry.py:28-38`). Thuần; câu chữ tiếng Việt giữ nguyên mgmt-app (màn S05 hiện `message`).
import type { ContractFieldKey, FieldValue } from "./fields.rules";

export type Warning = { field: string | null; code: string; message: string };
type Fields = Record<ContractFieldKey, { value: FieldValue }>;
export type ItemNumbers = { qty: number | null; unit_price: number | null };
/** `none_own` = không bên nào là pháp nhân của mình (chưa rõ mua/bán); `both_own` = nội bộ; null = đã rõ. */
export type DirectionCheck = "none_own" | "both_own" | null;

/** 10 số (doanh nghiệp), 10-3 (chi nhánh), 12 số (cá nhân, CCCD từ 2025-07-01); sai ⇒ null. */
export function normalizeTaxId(raw: string | null | undefined): string | null {
  const s = (raw ?? "").replace(/[\s.]/g, "");
  if (s.includes("-") && !/^\d{10}-\d{3}$/.test(s)) return null;
  const digits = s.replace(/-/g, "");
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 13) return `${digits.slice(0, 10)}-${digits.slice(10)}`;
  return digits.length === 10 || digits.length === 12 ? digits : null;
}

/** Nhóm nghìn bằng dấu chấm ("1.234.567"), không phụ thuộc Intl/locale. */
export function groupVi(n: number): string {
  const s = String(Math.round(Math.abs(n)));
  const g = s.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return n < 0 ? `-${g}` : g;
}

const val = (f: Fields, k: ContractFieldKey): FieldValue => f[k]?.value ?? null;

function totalWarning(f: Fields, items: readonly ItemNumbers[]): Warning | null {
  const total = val(f, "total_value");
  const priced = items.filter((i) => i.qty !== null && i.unit_price !== null);
  if (typeof total !== "number" || total === 0 || priced.length === 0) return null;
  if (priced.length !== items.length) return null;
  let s = priced.reduce((acc, i) => acc + (i.qty ?? 0) * (i.unit_price ?? 0), 0);
  const vat = val(f, "vat_rate");
  if (val(f, "vat_included") === true && typeof vat === "number" && vat) s *= 1 + vat / 100;
  if (Math.abs(s - total) <= 0.01 * total) return null;
  return {
    field: "total_value",
    code: "total_mismatch",
    message: `Tổng các dòng hàng (${groupVi(s)}) lệch hơn 1% so với giá trị hợp đồng.`,
  };
}

function directionWarning(d: DirectionCheck): Warning[] {
  if (d === "none_own")
    return [
      {
        field: null,
        code: "direction_unknown",
        message:
          "Không bên nào là pháp nhân của mình, nên chưa biết đây là HĐ mua hay bán. " +
          "Kiểm tra MST hai bên, hoặc đánh dấu pháp nhân trong mục Đối tác.",
      },
    ];
  if (d === "both_own")
    return [
      {
        field: null,
        code: "direction_internal",
        message: "Cả hai bên đều là pháp nhân của mình (giao dịch nội bộ).",
      },
    ];
  return [];
}

/** Luật: ngày ngược, tổng lệch > 1 %, MST sai định dạng, VAT chưa rõ, tự gia hạn thiếu báo trước, chiều mua/bán. */
export function ruleWarnings(
  f: Fields,
  items: readonly ItemNumbers[],
  direction: DirectionCheck = null,
  parties: Parties = {},
): Warning[] {
  const w: Warning[] = [];
  const [start, end] = [val(f, "start_date"), val(f, "end_date")];
  if (typeof start === "string" && typeof end === "string" && end < start)
    w.push({
      field: "end_date",
      code: "dates_order",
      message: "Ngày kết thúc trước ngày bắt đầu.",
    });
  const tw = totalWarning(f, items);
  if (tw) w.push(tw);
  for (const k of ["supplier_tax_id", "buyer_tax_id"] as const) {
    const tax = val(f, k);
    if (tax !== null && tax !== "" && !normalizeTaxId(String(tax)))
      w.push({
        field: k,
        code: "tax_id_format",
        message: "Mã số thuế phải có 10 chữ số, 13 chữ số (chi nhánh) hoặc 12 chữ số (cá nhân).",
      });
  }
  if (val(f, "vat_included") === null && (val(f, "total_value") || items.length > 0))
    w.push({
      field: "vat_included",
      code: "vat_unknown",
      message: "Chưa xác định giá đã gồm VAT hay chưa.",
    });
  if (val(f, "auto_renew") === true && val(f, "notice_days") === null)
    w.push({
      field: "notice_days",
      code: "notice_missing",
      message: "Hợp đồng tự động gia hạn nhưng chưa có số ngày báo trước.",
    });
  return [...w, ...directionWarning(direction), ...partyWarnings(f, parties)];
}

/** Kết quả tra Cục Thuế một bên (HD-FR-25). */
export type PartyCheck = {
  taxId: string | null;
  lookup: "found" | "not_found" | "no_tax" | "unavailable" | "invalid" | "skipped";
  registryName: string | null;
  status: string | null;
  active: boolean | null;
  nameMatch: boolean | null;
};
export type Parties = Partial<Record<"supplier" | "buyer", PartyCheck>>;
const SIDE_LABEL = { supplier: "bên bán", buyer: "bên mua" } as const;

/** Cảnh báo theo Cục Thuế (`verify.py:122-140`). */
export function partyWarnings(f: Fields, parties: Parties): Warning[] {
  const w: Warning[] = [];
  for (const side of ["supplier", "buyer"] as const) {
    const p = parties[side];
    if (!p) continue;
    const label = SIDE_LABEL[side];
    const [taxF, nameF] = [`${side}_tax_id`, `${side}_name`] as const;
    if (p.lookup === "not_found")
      w.push({
        field: taxF,
        code: "tax_not_found",
        message: `MST ${label} ${p.taxId} không tồn tại theo Cục Thuế. Kiểm tra lại số trong văn bản.`,
      });
    else if (p.lookup === "no_tax" && val(f, nameF))
      w.push({ field: taxF, code: "tax_missing", message: `Văn bản không nêu MST ${label}.` });
    if (p.active === false)
      w.push({
        field: taxF,
        code: "company_inactive",
        message: `${label[0]?.toUpperCase()}${label.slice(1)} đang ở tình trạng: ${p.status}.`,
      });
    if (p.nameMatch === false)
      w.push({
        field: nameF,
        code: "name_mismatch",
        message: `Tên ${label} khác tên theo Cục Thuế: ${p.registryName}.`,
      });
  }
  return w;
}
