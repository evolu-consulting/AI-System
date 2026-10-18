// HUB-FR-124 · P-d2 · D2-44 · input kiểu `number`: chuỗi số hữu hạn (cùng luật `isNumberText` của Hub). Thuần, built-in.

/** Khoá i18n dưới trường `number` khi giá trị không phải số. */
export const NUMBER_INPUT_INVALID_KEY = "process.inputs.err.number.invalid";

export const isNumberText = (s: string): boolean =>
  s.trim() !== "" && Number.isFinite(Number(s.trim()));
