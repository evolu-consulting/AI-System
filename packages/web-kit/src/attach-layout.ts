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
};
