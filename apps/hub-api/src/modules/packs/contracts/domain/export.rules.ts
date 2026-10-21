// Gap #8 · xuất danh sách HĐ: cột + định dạng ô (tiêu đề tiếng Việt, tiền/ngày/giờ) + CSV. Thuần (không đọc DB, không npm).
// Ngày `YYYY-MM-DD` giữ nguyên ý nghĩa lịch (không qua Date/múi giờ); giờ cập nhật theo múi tenant.

export type ExportColumn = {
  key: string;
  header: string;
  kind: "text" | "money" | "date" | "datetime";
  /** Độ rộng cột xlsx (ký tự). */
  width: number;
};

/** Một ô thô: chữ, số (tiền, đồng), ngày `YYYY-MM-DD`, hoặc thời điểm; trống ⇒ null. */
export type ExportCell = string | number | Date | null;

/** Hàng đã quy đổi nhãn (chưa định dạng hiển thị). Khoá = `ExportColumn.key`. */
export type ExportInput = {
  number: string | null;
  title: string;
  kind: string;
  type: string | null;
  direction: string | null;
  status: string;
  seller: string | null;
  buyer: string | null;
  sellerSigner: string | null;
  buyerSigner: string | null;
  value: number | null;
  endDate: string | null;
  actionDeadline: string | null;
  categories: readonly string[];
  updatedAt: Date;
};

export const EXPORT_COLUMNS: readonly ExportColumn[] = [
  { key: "stt", header: "STT", kind: "text", width: 6 },
  { key: "number", header: "Số hợp đồng", kind: "text", width: 18 },
  { key: "title", header: "Tên hợp đồng", kind: "text", width: 44 },
  { key: "kind", header: "Hình thức", kind: "text", width: 12 },
  { key: "type", header: "Loại hợp đồng", kind: "text", width: 18 },
  { key: "direction", header: "Mua / bán", kind: "text", width: 11 },
  { key: "seller", header: "Bên bán", kind: "text", width: 32 },
  { key: "buyer", header: "Bên mua", kind: "text", width: 32 },
  { key: "sellerSigner", header: "Người ký bên bán", kind: "text", width: 24 },
  { key: "buyerSigner", header: "Người ký bên mua", kind: "text", width: 24 },
  { key: "value", header: "Giá trị (đ)", kind: "money", width: 18 },
  { key: "endDate", header: "Hiệu lực đến", kind: "date", width: 14 },
  { key: "actionDeadline", header: "Hạn chót xử lý", kind: "date", width: 14 },
  { key: "status", header: "Trạng thái", kind: "text", width: 16 },
  { key: "owner", header: "Phụ trách", kind: "text", width: 22 },
  { key: "categories", header: "Loại hàng", kind: "text", width: 28 },
  { key: "updatedAt", header: "Cập nhật", kind: "datetime", width: 17 },
];

const STATUS_VI: Record<string, string> = {
  needs_review: "Chờ xác nhận",
  extracting: "Đang đọc",
  extract_failed: "Đọc lỗi",
  active: "Đang hiệu lực",
  expiring: "Sắp đáo hạn",
  expired: "Đã hết hạn",
  renewed: "Đã xử lý",
  terminated: "Đã xử lý",
  rejected: "Bị từ chối",
};
const DIRECTION_VI: Record<string, string> = { sale: "Bán ra", purchase: "Mua vào" };
const TYPE_VI: Record<string, string> = {
  purchase: "Mua bán hàng hoá",
  service: "Dịch vụ",
  framework: "Khung",
  principle: "Nguyên tắc",
};
const KIND_VI: Record<string, string> = { contract: "Hợp đồng", appendix: "Phụ lục" };

/** Tên người phụ trách theo id (danh bạ tenant); id lạ ⇒ rỗng. */
export type OwnerNames = ReadonlyMap<string, string>;

/** Hàng thô ⇒ ô theo thứ tự `EXPORT_COLUMNS` (STT từ 1). */
export function exportCells(
  r: ExportInput & { ownerUserId: string | null },
  stt: number,
  owners: OwnerNames,
): ExportCell[] {
  return [
    stt === 0 ? null : String(stt),
    r.number,
    r.title,
    KIND_VI[r.kind] ?? r.kind,
    r.type ? (TYPE_VI[r.type] ?? r.type) : null,
    DIRECTION_VI[r.direction ?? ""] ?? "Chưa rõ",
    r.seller,
    r.buyer,
    r.sellerSigner,
    r.buyerSigner,
    r.value,
    r.endDate,
    r.actionDeadline,
    STATUS_VI[r.status] ?? r.status,
    r.ownerUserId ? (owners.get(r.ownerUserId) ?? null) : null,
    r.categories.length ? r.categories.join(", ") : null,
    r.updatedAt,
  ];
}

/** `YYYY-MM-DD` ⇒ `dd/mm/yyyy`; sai dạng ⇒ giữ nguyên (không đoán). */
export function viDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/** Thời điểm ⇒ `dd/mm/yyyy HH:mm` theo múi `tz` (IANA). */
export function viDateTime(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${g("day")}/${g("month")}/${g("year")} ${g("hour")}:${g("minute")}`;
}

/** Số ngày từ 1899-12-30 (gốc serial của Excel) tới `YYYY-MM-DD` (lịch UTC). */
export function excelDateSerial(iso: string): number | null {
  const t = Date.parse(`${iso}T00:00:00Z`);
  return Number.isNaN(t) ? null : Math.round((t - Date.UTC(1899, 11, 30)) / 86_400_000);
}

/** Thời điểm ⇒ serial Excel (phần thập phân = giờ) theo múi `tz`: Excel không có múi giờ nên giờ đã quy về giờ tường của tenant. */
export function excelDateTimeSerial(d: Date, tz: string): number {
  const p = viDateTime(d, tz); // dd/mm/yyyy HH:mm
  const iso = `${p.slice(6, 10)}-${p.slice(3, 5)}-${p.slice(0, 2)}`;
  const day = excelDateSerial(iso) ?? 0;
  return day + (Number(p.slice(11, 13)) * 60 + Number(p.slice(14, 16))) / 1440;
}

/** Ô CSV hiển thị: tiền = số nguyên không phân cách (đọc máy được), ngày dd/mm/yyyy, giờ theo múi tenant. */
export function csvText(c: ExportCell, kind: ExportColumn["kind"], tz: string): string {
  if (c === null) return "";
  if (c instanceof Date) return viDateTime(c, tz);
  if (typeof c === "number") return String(c);
  return kind === "date" ? viDate(c) : c;
}

/** Chống công thức khi mở bằng Excel (CSV injection): ô chữ bắt đầu `= + - @` hoặc tab/CR ⇒ thêm `'` đầu. */
export function guardFormula(s: string): string {
  return /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
}

/** Một ô CSV theo RFC 4180 (bọc `"` khi có `, " CR LF`). */
export function csvField(s: string): string {
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Một dòng CSV (kết thúc CRLF). Ô chữ qua `guardFormula`; số/ngày/giờ do hệ thống sinh nên không cần. */
export function csvLine(cells: readonly ExportCell[], tz: string): string {
  return `${EXPORT_COLUMNS.map((col, i) => {
    const c = cells[i] ?? null;
    const t = csvText(c, col.kind, tz);
    return csvField(typeof c === "string" && col.kind === "text" ? guardFormula(t) : t);
  }).join(",")}\r\n`;
}

export const CSV_HEADER_LINE = `${EXPORT_COLUMNS.map((c) => csvField(c.header)).join(",")}\r\n`;

/** Tên tệp tải về: `hop-dong-YYYYMMDD.<ext>` theo ngày lịch tenant. */
export const exportFileName = (today: string, ext: string): string =>
  `hop-dong-${today.replace(/-/g, "")}.${ext}`;
