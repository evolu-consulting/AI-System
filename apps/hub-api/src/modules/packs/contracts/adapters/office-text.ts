// CR-122 p9 · FLOW2-FR-27: zip-office khác DOCX (xlsx, pptx, odt) ⇒ chữ. `fflate` (đã có) chỉ giải nén các XML chứa chữ
// (xlsx `sharedStrings`, pptx `slides/slideN`, odt `content.xml`), mỗi phần ≤ 20 MiB; gom chữ trong thẻ. Không ném.
import { unzipSync } from "fflate";
import { markupToText, TEXT_MAX_CHARS } from "../domain/text-formats.rules";

const TEXT_PARTS = /^(xl\/sharedStrings\.xml|ppt\/slides\/slide\d+\.xml|content\.xml)$/;
const PART_MAX = 20 * 1024 * 1024;

export function officeText(bytes: Uint8Array): string | null {
  try {
    const parts = unzipSync(bytes, {
      filter: (f) => TEXT_PARTS.test(f.name) && f.originalSize <= PART_MAX,
    });
    const dec = new TextDecoder();
    const text = markupToText(
      Object.keys(parts)
        .sort((a, b) => a.localeCompare(b, "en", { numeric: true }))
        .map((n) => dec.decode(parts[n]))
        .join(" "),
    );
    return text ? text.slice(0, TEXT_MAX_CHARS) : null;
  } catch {
    return null;
  }
}
