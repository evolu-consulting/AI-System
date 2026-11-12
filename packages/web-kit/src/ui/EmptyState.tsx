// CR-131 · trạng thái trống / không tìm thấy dùng chung (Luật gốc 2: một khái niệm = một component ở mọi app).
// `kind` chọn hình; câu chữ do app truyền (đã i18n). Không phụ thuộc router: `NotFoundPage` nhận `Link` của app.
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { type EmptyKind, ILLUSTRATIONS } from "./illustrations";

export type { EmptyKind };

export type EmptyStateProps = {
  kind: EmptyKind;
  title: string;
  hint?: ReactNode;
  action?: ReactNode;
  testId?: string;
  /** data-testid riêng cho dòng tiêu đề (e2e so khớp nguyên văn câu, không kèm nút). */
  titleTestId?: string;
  /** `page` ⇒ căn giữa cả khung (trang lạ); mặc định ⇒ khối trong trang. */
  full?: boolean;
};

const WRAP: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  textAlign: "center",
  padding: "48px 24px",
  gap: 6,
};
const FULL: CSSProperties = { ...WRAP, flex: 1, minHeight: "60vh", justifyContent: "center" };

export function EmptyState({
  kind,
  title,
  hint,
  action,
  testId,
  titleTestId,
  full,
}: EmptyStateProps) {
  const Art = ILLUSTRATIONS[kind];
  const Title = full ? "h1" : "p"; // trang đầy đủ (đường lạ / phòng không có) ⇒ heading cấp 1 cho trình đọc màn hình + e2e
  return (
    <div
      data-testid={testId}
      data-kind={kind}
      style={full ? FULL : WRAP}
      role={kind === "error" ? "alert" : undefined}
    >
      <span style={{ color: "var(--muted-foreground, #6b6b6b)", marginBottom: 8, display: "flex" }}>
        <Art />
      </span>
      <Title
        data-testid={titleTestId}
        style={{ margin: 0, fontWeight: 600, color: "var(--foreground, inherit)" }}
      >
        {title}
      </Title>
      {hint && (
        <div style={{ maxWidth: 380, fontSize: 14, color: "var(--muted-foreground, #6b6b6b)" }}>
          {hint}
        </div>
      )}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  );
}

export type LinkLike = ComponentType<{ to: string; style?: CSSProperties; children: ReactNode }>;

const BTN: CSSProperties = {
  display: "inline-block",
  padding: "8px 16px",
  borderRadius: 8,
  border: "1px solid var(--border, #e5e5e5)",
  background: "var(--card, #fff)",
  color: "var(--foreground, inherit)",
  fontSize: 14,
  fontWeight: 500,
  textDecoration: "none",
};

/** Trang lạ / không có quyền: MỘT câu chung + nút về trang chính. `Link` = Link của router app (mặc định thẻ `<a href>`). */
export function NotFoundPage({
  title,
  hint,
  homeTo,
  homeLabel,
  Link,
  testId = "not-found-page",
}: {
  title: string;
  hint?: ReactNode;
  homeTo: string;
  homeLabel: string;
  Link?: LinkLike;
  testId?: string;
}) {
  const action = Link ? (
    <Link to={homeTo} style={BTN}>
      {homeLabel}
    </Link>
  ) : (
    <a href={homeTo} style={BTN}>
      {homeLabel}
    </a>
  );
  return (
    <EmptyState kind="notFound" title={title} hint={hint} action={action} testId={testId} full />
  );
}
