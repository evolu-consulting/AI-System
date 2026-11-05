// PK-FR-10 · TF2 · định dạng số/ngày kiểu người Việt. Nguồn: reference/mgmt-app-contracts/web/src/components/ui.tsx:3-35 (port nguyên logic).

export const vnd = (n: number | null | undefined): string =>
  n == null ? "—" : n.toLocaleString("vi-VN");

/** "2026-10-16" → "16/10/2026". Timestamp (UTC) đặt về giờ Việt Nam trước, để lưu 06:00 ở Hà Nội ra đúng ngày đó. */
export const viDate = (iso: string | null | undefined): string => {
  if (!iso) return "—";
  const day =
    iso.length > 10 && iso.includes("T")
      ? new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Ho_Chi_Minh" })
      : iso.slice(0, 10);
  return day.split("-").reverse().join("/");
};

/** Tiền/đếm theo đồng: bỏ mọi ký tự không phải số ("91.500.000 đ" → 91500000). Rỗng → null; rác → NaN. */
export const parseMoney = (s: string): number | null => {
  const t = s.trim();
  if (!t) return null;
  const digits = t.replace(/\D/g, "");
  return digits ? Number(digits) : NaN;
};

/** Số lượng có phần thập phân: "1.500" → 1500, "1,5" → 1.5. Rỗng → null; rác → NaN. */
export const parseQty = (s: string): number | null => {
  const t = s.trim().replace(/\s/g, "");
  if (!t) return null;
  if (/^\d{1,3}(\.\d{3})*(,\d+)?$|^\d+(,\d+)?$/.test(t))
    return Number(t.replace(/\./g, "").replace(",", "."));
  if (/^\d+\.(\d{1,2}|\d{4,})$/.test(t)) return Number(t); // dấu thập phân kiểu máy ("1.5" do trợ lý điền)
  return Number.NaN;
};

/** Màu chữ theo trạng thái: hạn gần = hổ phách, trễ = đỏ, còn lại xám. */
export type Tone = "late" | "soon" | "ok" | "dim" | "act";
export const TONE_TEXT: Record<Tone, string> = {
  late: "font-semibold text-late",
  soon: "font-semibold text-soon",
  ok: "font-semibold text-ok",
  dim: "text-dim",
  act: "text-act",
};
