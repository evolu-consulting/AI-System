// CR-122 · P14: trường kỹ thuật bắt buộc của node (mã giai đoạn, tên tệp kết quả, mẫu kết quả) tự sinh —
// người dùng không phải điền (Luật GỐC 3). Hàm thuần.
import type { DefDraft, StageDraft } from "./draft-types";
import { slugKey } from "./stage-key";

const DEFAULT_SECTION = "Kết quả";

export const defaultFilename = (key: string): string => `${key}.md`;
export const defaultTemplate = (name: string): string => `# ${name.trim() || DEFAULT_SECTION}`;

/** Điền các trường kỹ thuật còn trống (không đè giá trị đã có). `taken` = mã các giai đoạn khác. */
export function withNodeDefaults(s: StageDraft, taken: readonly string[]): StageDraft {
  const key = s.key === "" ? slugKey(s.name, taken) : s.key;
  return {
    ...s,
    key,
    filename: s.filename === "" ? defaultFilename(key) : s.filename,
    template: s.template === "" ? defaultTemplate(s.name) : s.template,
    sections: s.sections.length === 0 ? [DEFAULT_SECTION] : s.sections,
  };
}

/** Flow cũ thiếu trường kỹ thuật ⇒ điền mặc định (mở / lưu), mã không trùng nhau. */
export function fillDraftDefaults(d: DefDraft): DefDraft {
  const stages: StageDraft[] = [];
  for (const s of d.stages) {
    const others = [
      ...stages.map((o) => o.key),
      ...d.stages.filter((o) => o !== s).map((o) => o.key),
    ];
    stages.push(withNodeDefaults(s, others));
  }
  return { ...d, stages };
}

/** Đổi tên khi mã còn tự sinh: tên tệp / mẫu mặc định theo mã / tên cũ thì đi theo. */
export function followRename(prev: StageDraft, next: StageDraft): StageDraft {
  const out = { ...next };
  if (prev.filename === defaultFilename(prev.key)) out.filename = defaultFilename(next.key);
  if (prev.template === defaultTemplate(prev.name)) out.template = defaultTemplate(next.name);
  return out;
}
