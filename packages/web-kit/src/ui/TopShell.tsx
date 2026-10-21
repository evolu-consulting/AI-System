// app-catalog · thanh trên dùng chung (chuẩn = thanh trên Sổ Hợp Tác 52px; admin/chat/studio-web): cùng chiều cao/viền/nền; slot trái (`start`), phải (`children`),
// switcher "Ứng dụng" (`apps`) rồi `end` (menu tài khoản). Style nội tuyến + biến màu của app (xem AppSwitcher).
import type { CSSProperties, ReactElement, ReactNode } from "react";

const HEADER: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  height: 52,
  flexShrink: 0,
  padding: "0 20px",
  borderBottom: "1px solid var(--rule, var(--border, #e5e5e5))",
  background: "var(--panel, var(--card, #fff))",
  color: "var(--foreground, inherit)",
};
const RIGHT: CSSProperties = { marginLeft: "auto", display: "flex", alignItems: "center", gap: 4 };

export function TopShell(p: {
  start?: ReactNode;
  children?: ReactNode;
  apps?: ReactNode;
  /** Thứ tự phải: apps (lưới), bell (chuông thông báo), feedback (góp ý), end (tài khoản). */
  bell?: ReactNode;
  feedback?: ReactNode;
  end?: ReactNode;
}): ReactElement {
  return (
    <header style={HEADER}>
      {p.start}
      <div style={RIGHT}>
        {p.children}
        {p.apps}
        {p.bell}
        {p.feedback}
        {p.end}
      </div>
    </header>
  );
}
