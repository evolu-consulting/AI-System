/// <reference types="@rsbuild/core/types" />

interface ImportMetaEnv {
  /** URL Evolu Copilot (tuỳ chọn, M1 FE3). Rsbuild nhúng biến `PUBLIC_*` lúc build. */
  readonly PUBLIC_CHAT_APP_URL?: string;
  /** Gốc Hub (X1 F5): admin-web gọi thẳng `/agent-grants*`. Vắng → "Chưa cấu hình địa chỉ Hub". */
  readonly PUBLIC_HUB_URL?: string;
  /** URL Agent Forge (X1 F6): nút "⇄ Agent Forge" của platform_admin. Vắng → ẩn nút. */
  readonly PUBLIC_STUDIO_URL?: string;
}
