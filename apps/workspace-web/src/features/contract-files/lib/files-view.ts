// CR-133 · «Tài liệu kèm» — nhãn thuần cho UI (không React): kích thước, nhãn nguồn của tệp bước duyệt, khoá câu lỗi.
const KB = 1024;
const MB = KB * 1024;

export function sizeLabel(bytes: number): string {
  if (bytes >= MB) return `${(bytes / MB).toFixed(1).replace(/\.0$/, "")} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

/** Nguồn liên kết tệp với lượt duyệt ⇒ khoá chuỗi (người dùng thấy «khi nào tệp được kèm», không thấy khái niệm kỹ thuật). */
export function sourceKey(source: string): string {
  return source === "form" || source === "subprocess" ? source : "start";
}

const ERR = new Set(["FILE_TYPE", "FILE_TOO_LARGE", "CONTRACT_FILES_FULL", "PACK_FORBIDDEN"]);
/** Mã lỗi API ⇒ khoá chuỗi nói cách khắc phục; lạ ⇒ `generic`. */
export const errorKey = (code: string | undefined): string =>
  code && ERR.has(code) ? code : "generic";
