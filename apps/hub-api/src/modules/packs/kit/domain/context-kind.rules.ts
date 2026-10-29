// one-agent: kind ngữ cảnh mà gói trả nhãn (lớp 1, thuần). Khớp `CONTEXT_ENTITY_KINDS` của @ai/contracts/chat; adapter
// (pack-tools.registry) dùng kiểu của contracts nên lệch → lỗi biên dịch.
export type ContextEntityKind = "contract" | "partner";
