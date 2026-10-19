// HD-FR-08 · D-09 · D-17 · ADR-0024 · plan §4: tên phần trong zip (cấp `zipNames` cho `sniffFileType`). `fflate.unzipSync` với
// `filter` trả false ⇒ chỉ duyệt central directory, KHÔNG giải nén phần nào (bom zip do `DocxConverter` chặn). Zip hỏng ⇒ `[]`
// (⇒ 415). Chỉ gọi khi 4 byte đầu là `PK\x03\x04`.
import { unzipSync } from "fflate";

export function zipNames(bytes: Uint8Array): string[] {
  const names: string[] = [];
  try {
    unzipSync(bytes, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return [];
  }
  return names;
}
