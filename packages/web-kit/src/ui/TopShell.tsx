// app-catalog · thanh trên dùng chung (admin-web, studio-web): cùng chiều cao/viền/nền; slot trái (`start`), phải (`children`),
// switcher "Ứng dụng" (`apps`) rồi `end` (menu tài khoản). Style nội tuyến + biến màu của app (xem AppSwitcher).
import type { CSSProperties, ReactElement, ReactNode } from "react";

const HEADER: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  height: "var(--spacing-topbar, 60px)",
  flexShrink: 0,
  padding: "0 16px",
  borderBottom: "1px solid var(--border, #e5e5e5)",
  background: "var(--card, #fff)",
  color: "var(--foreground, inherit)",
};
const RIGHT: CSSProperties = { marginLeft: "auto", display: "flex", alignItems: "center", gap: 12 };

export function TopShell(p: {
  start?: ReactNode;
  children?: ReactNode;
  apps?: ReactNode;
  end?: ReactNode;
}): ReactElement {
  return (
    <header style={HEADER}>
      {p.start}
      <div style={RIGHT}>
        {p.children}
        {p.apps}
        {p.end}
      </div>
    </header>
  );
}
