// CR-169 · lát 6 · luật thuần bộ lọc công ty của «Tin nhắn»: «Tất cả» | công ty mình | một công ty đã kết nối (spec §8). Không gọi mạng.
import type { MsgCompany } from "@ai/contracts/pack-contracts";

/** `all` · `own` · uuid công ty đã kết nối (chữ thường). */
export type CompanyFilter = "all" | "own" | (string & {});

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Số chip công ty hiện thẳng; từ công ty thứ 6 trở đi ⇒ gộp vào «Công ty khác ▾» (spec §8). */
export const CHIP_COMPANIES_MAX = 5;

/** Tham số `?company=` (nút «Nhắn tin» ở trang đối tác) ⇒ bộ lọc. CR-172: rỗng/sai dạng ⇒ `own` (công ty mình; chưa biết công ty mình ⇒ `all`);
 * `all` chỉ khi chọn «Tất cả» hoặc `?company=all`; trúng công ty mình ⇒ `own`. */
export function parseFilter(raw: string | null | undefined, ownId: string): CompanyFilter {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "all") return "all";
  if (v === "own") return "own";
  if (!UUID.test(v)) return ownId ? "own" : "all";
  return v === ownId.toLowerCase() ? "own" : v;
}

/** Giá trị gửi lên API: `all` là mặc định ⇒ không gửi. */
export const filterParam = (f: CompanyFilter): string | undefined => (f === "all" ? undefined : f);

export const isCompanyFilter = (f: CompanyFilter): boolean => f !== "all" && f !== "own";

export type ChipPlan = {
  /** Công ty hiện thẳng thành chip (tối đa `CHIP_COMPANIES_MAX`, luôn gồm công ty đang chọn). */
  chips: MsgCompany[];
  /** Còn công ty ngoài chip ⇒ hiện «Công ty khác ▾». */
  more: boolean;
};

/** Chọn chip: công ty đang chọn không bị đẩy vào «Công ty khác» (người dùng luôn thấy mình đang lọc gì). */
export function planChips(
  companies: readonly MsgCompany[],
  selected: CompanyFilter,
  hasMorePages: boolean,
): ChipPlan {
  const shown = companies.slice(0, CHIP_COMPANIES_MAX);
  const sel = isCompanyFilter(selected) ? companies.find((c) => c.id === selected) : undefined;
  const chips = sel && !shown.some((c) => c.id === sel.id) ? [...shown.slice(0, -1), sel] : shown;
  return { chips, more: companies.length > CHIP_COMPANIES_MAX || hasMorePages };
}

/** Tên công ty đang lọc (cho câu «Chưa nhắn với ai ở …», nút «Bảng tin …»); chưa biết ⇒ "". */
export function companyName(
  filter: CompanyFilter,
  companies: readonly MsgCompany[],
  extra?: MsgCompany | null,
): string {
  if (!isCompanyFilter(filter)) return "";
  return companies.find((c) => c.id === filter)?.name ?? (extra?.id === filter ? extra.name : "");
}
