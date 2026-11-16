// CR-164 · bố cục ảnh + tệp đính kèm dùng chung (Community, Chat, sau này trò chuyện công ty). Logic thuần, không React.

/** Một tệp đính kèm đã lên server. `disabled` = không tải được (xám). */
export type AttachItem = {
  id: string;
  name: string;
  mime: string;
  size?: number;
  disabled?: boolean;
};

export type FileKind = "pdf" | "image" | "doc" | "sheet" | "text" | "archive" | "other";

/** Loại tệp ⇒ chọn icon. Ưu tiên MIME, rơi về đuôi tên. */
export function fileKind(mime: string, name: string): FileKind {
  const m = mime.toLowerCase();
  const ext = name.includes(".") ? (name.split(".").pop() ?? "").toLowerCase() : "";
  if (m.startsWith("image/")) return "image";
  if (m.includes("pdf") || ext === "pdf") return "pdf";
  if (m.includes("spreadsheet") || m.includes("excel") || ["xls", "xlsx", "csv"].includes(ext))
    return "sheet";
  if (m.includes("word") || m.includes("document") || ["doc", "docx", "odt", "rtf"].includes(ext))
    return "doc";
  if (m.startsWith("text/") || ["txt", "md", "json"].includes(ext)) return "text";
  if (m.includes("zip") || m.includes("compressed") || ["zip", "rar", "7z", "gz"].includes(ext))
    return "archive";
  return "other";
}

export const isImageItem = (a: AttachItem): boolean => !a.disabled && a.mime.startsWith("image/");
export const isPdfItem = (a: AttachItem): boolean =>
  !a.disabled && fileKind(a.mime, a.name) === "pdf";

/** Tách ảnh (vẽ lưới) khỏi tệp (vẽ thẻ), giữ thứ tự. */
export function splitAttachments(items: readonly AttachItem[]): {
  images: AttachItem[];
  files: AttachItem[];
} {
  const images: AttachItem[] = [];
  const files: AttachItem[] = [];
  for (const a of items) (isImageItem(a) ? images : files).push(a);
  return { images, files };
}

export type ImageLayout = {
  /** one = 1 ảnh lớn giữ tỉ lệ · two = 2 ô ngang · three = 1 lớn trái + 2 nhỏ phải · four = lưới 2×2. */
  variant: "none" | "one" | "two" | "three" | "four";
  shown: number;
  /** Số ảnh dư, phủ «+N» lên ô cuối (chỉ khi ≥ 5 ảnh). */
  extra: number;
};

export function imageLayout(n: number): ImageLayout {
  if (n <= 0) return { variant: "none", shown: 0, extra: 0 };
  if (n === 1) return { variant: "one", shown: 1, extra: 0 };
  if (n === 2) return { variant: "two", shown: 2, extra: 0 };
  if (n === 3) return { variant: "three", shown: 3, extra: 0 };
  return { variant: "four", shown: 4, extra: n - 4 };
}

/** Qua lại vòng tròn giữa các ảnh. */
export const stepIndex = (i: number, delta: number, n: number): number =>
  n <= 0 ? 0 : (((i + delta) % n) + n) % n;

/** Tên dài cắt GIỮA, giữ đuôi: "bao-cao-quy-3-2026.pdf" ⇒ "bao-cao-…2026.pdf". */
export function truncateMiddle(name: string, max = 32): string {
  if (max < 5 || name.length <= max) return name;
  const dot = name.lastIndexOf(".");
  const ext = dot > 0 && name.length - dot <= 6 ? name.slice(dot) : "";
  const tail = ext.length + Math.max(2, Math.floor((max - 1 - ext.length) / 3));
  const head = max - 1 - tail;
  return `${name.slice(0, head)}…${name.slice(name.length - tail)}`;
}

/** 1536 ⇒ "1,5 KB" (dấu thập phân theo `locale`). */
export function formatBytes(bytes: number, locale = "vi-VN"): string {
  const units = ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  const n =
    i === 0 ? String(Math.round(v)) : v.toLocaleString(locale, { maximumFractionDigits: 1 });
  return `${n} ${units[i]}`;
}

/** Chữ cho nút/aria — app truyền vào (i18n nằm ở app, web-kit không phụ thuộc i18n). */
export type AttachLabels = {
  openImage: (name: string) => string;
  prev: string;
  next: string;
  close: string;
  download: string;
  downloadOf: (name: string) => string;
  view: string;
  failed: string;
  uploading: string;
  retry: string;
  remove: (name: string) => string;
  unavailable: string;
  /** CR-179 · «Đang tải…» trong hộp xem trước (không có ⇒ «…»). */
  loading?: string;
};

/** CR-173 · chữ của ô chọn tệp dùng chung (app truyền — web-kit không phụ thuộc i18n). */
export type AttachPickLabels = {
  /** «Kéo thả tệp vào đây hoặc» (đứng trước nút). */
  drop: string;
  /** Nút «Chọn tệp». */
  choose: string;
  /** Khi đang rê tệp vào vùng: «Thả tệp để đính kèm». */
  dropActive: string;
  /** Từ chỉ nhóm ảnh trong dòng gợi ý («ảnh»). */
  image: string;
  /** Tên nút icon kẹp giấy (bản gọn). */
  attach: string;
  /** Dòng gợi ý: `types` = «PDF, DOCX», `size` = «20 MB». */
  hint: (types: string, size: string) => string;
  tooBig: (name: string, max: string) => string;
  badType: (name: string) => string;
  tooMany: (max: number) => string;
};

/** Luật chọn tệp: `accept` kiểu thuộc tính HTML (`.pdf,.docx,image/*`), tối đa `maxBytes` mỗi tệp, tối đa `maxFiles` tệp. */
export type PickRule = { accept?: string; maxBytes?: number; maxFiles?: number };

export type PickReject = { name: string; reason: "type" | "size" | "count" };

const acceptTokens = (accept: string): string[] =>
  accept
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

/** Một tệp có khớp `accept`? (đuôi `.pdf`, MIME đủ `image/png` hoặc nhóm `image/*`). Không `accept` ⇒ nhận hết. */
export function matchesAccept(file: { name: string; type: string }, accept?: string): boolean {
  const toks = accept ? acceptTokens(accept) : [];
  if (toks.length === 0) return true;
  const name = file.name.toLowerCase();
  const mime = file.type.toLowerCase();
  return toks.some((t) =>
    t.startsWith(".")
      ? name.endsWith(t)
      : t.endsWith("/*")
        ? mime.startsWith(t.slice(0, -1))
        : mime === t,
  );
}

/** Tách tệp hợp lệ khỏi tệp bị từ chối (sai loại ⇒ quá cỡ ⇒ quá số lượng). `existing` = số tệp đã có. */
export function validateFiles(
  files: readonly File[],
  rule: PickRule,
  existing = 0,
): { ok: File[]; rejects: PickReject[] } {
  const ok: File[] = [];
  const rejects: PickReject[] = [];
  for (const f of files) {
    if (!matchesAccept(f, rule.accept)) rejects.push({ name: f.name, reason: "type" });
    else if (rule.maxBytes !== undefined && f.size > rule.maxBytes)
      rejects.push({ name: f.name, reason: "size" });
    else if (rule.maxFiles !== undefined && existing + ok.length >= rule.maxFiles)
      rejects.push({ name: f.name, reason: "count" });
    else ok.push(f);
  }
  return { ok, rejects };
}

/** `.pdf,.docx,image/*` ⇒ «PDF, DOCX» (nhóm ảnh ⇒ «ảnh» do app đặt qua `imageWord`). */
export function acceptTypesLabel(accept: string | undefined, imageWord = "image"): string {
  const seen: string[] = [];
  for (const t of accept ? acceptTokens(accept) : []) {
    const v = t.startsWith(".") ? t.slice(1).toUpperCase() : t === "image/*" ? imageWord : null;
    if (v && !seen.includes(v)) seen.push(v);
  }
  return seen.join(", ");
}

/** Câu lỗi của một tệp bị từ chối. */
export function rejectText(
  r: PickReject,
  labels: AttachPickLabels,
  rule: PickRule,
  locale?: string,
) {
  if (r.reason === "type") return labels.badType(r.name);
  if (r.reason === "size") return labels.tooBig(r.name, formatBytes(rule.maxBytes ?? 0, locale));
  return labels.tooMany(rule.maxFiles ?? 0);
}

/** Dựng nhãn từ hàm dịch + tiền tố khoá (`contracts.attachPick` / `attach.pick`): MỘT bộ khoá, hai bản dịch ở app. */
export function attachPickLabels(
  t: (key: string, opts?: Record<string, string | number>) => string,
  prefix: string,
): AttachPickLabels {
  return {
    drop: t(`${prefix}.drop`),
    choose: t(`${prefix}.choose`),
    dropActive: t(`${prefix}.dropActive`),
    image: t(`${prefix}.image`),
    attach: t(`${prefix}.attach`),
    hint: (types, size) => t(`${prefix}.hint`, { types, size }),
    tooBig: (name, max) => t(`${prefix}.tooBig`, { name, max }),
    badType: (name) => t(`${prefix}.badType`, { name }),
    tooMany: (max) => t(`${prefix}.tooMany`, { max }),
  };
}

/** CR-179 · kích thước cố định của khung tệp (MỘT chỗ): khung có kích thước ngay lần render đầu, không phình khi tải xong. */
export const ATTACH_SIZE = {
  /** Ảnh đơn: khung 4:3, rộng tối đa 420. */
  oneMaxWidth: 420,
  oneRatio: "4 / 3",
  gridMaxWidth: 480,
  gridTwoHeight: 200,
  gridManyHeight: 280,
  /** Thẻ tệp: cao cố định (tên 1 dòng + dung lượng 1 dòng). */
  cardHeight: 56,
  cardMaxWidth: 420,
  /** Hộp xem trước: theo khung nhìn, không đổi khi nội dung về. */
  viewerWidth: "min(90vw, 960px)",
  viewerHeight: "min(80vh, 720px)",
  /** Chip tải lên (ô soạn gọn / thường). */
  chipHeight: 56,
  chipHeightCompact: 44,
  chipWidth: 280,
  chipWidthCompact: 220,
} as const;

export type LoadPhase = "loading" | "ready" | "error";

/** Trạng thái hiển thị của một ảnh/khung: chưa có URL ⇒ loading; có URL nhưng `<img>` chưa onLoad ⇒ loading (khung giữ chỗ, ảnh ẩn). */
export function loadPhase(s: { url: string | null; failed: boolean; loaded: boolean }): LoadPhase {
  if (s.failed) return "error";
  return s.url && s.loaded ? "ready" : "loading";
}

/** Kiểu khung ảnh: một ảnh ⇒ khung 4:3 cố định; lưới ⇒ ô theo ô lưới (đã cố định chiều cao ở lưới). */
export function thumbFrame(big: boolean): {
  aspectRatio?: string;
  width?: string;
  maxWidth?: number;
} {
  return big
    ? { aspectRatio: ATTACH_SIZE.oneRatio, width: "100%", maxWidth: ATTACH_SIZE.oneMaxWidth }
    : {};
}
