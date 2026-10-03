// ADM-FR-54 · M4-R14 · kiểm file import ở client trước khi gửi (plan-frontend §3.5, §5): đuôi .yaml/.yml, ≤ 1 MB.
import { IMPORT_MAX_BYTES } from "@ai/contracts";

export type ImportFileProblem = "wrongType" | "tooLarge";

const YAML_RE = /\.ya?ml$/i;

/** `null` = gửi được; nếu không → key `transfer.import.{problem}`. */
export function checkImportFile(file: { name: string; size: number }): ImportFileProblem | null {
  if (!YAML_RE.test(file.name)) return "wrongType";
  if (file.size > IMPORT_MAX_BYTES) return "tooLarge";
  return null;
}

/** Kích thước hiển thị gọn: `812 B`, `4,2 KB`, `1,0 MB` (theo locale). */
export function formatFileSize(bytes: number, locale: string): string {
  const fmt = (n: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024)} KB`;
  return `${fmt(bytes / (1024 * 1024))} MB`;
}
