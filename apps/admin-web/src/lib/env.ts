// X1 F6 · URL Agent Studio (`PUBLIC_STUDIO_URL`, nhúng lúc build). Vắng/rỗng → "" → ẩn nút "⇄ Agent Studio".
export const STUDIO_URL: string = (import.meta.env.PUBLIC_STUDIO_URL ?? "")
  .trim()
  .replace(/\/+$/, "");
