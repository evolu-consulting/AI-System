// feedback · nút "Góp ý" trên thanh trên chung (cùng chỗ biểu tượng góp ý của contracts-web: nhóm bên phải, trước "Ứng dụng") + ngăn kéo
// chứa khung góp ý. Dùng ở Chat AI, Admin, Studio (`TopShell` slot `children`); contracts-web dùng khoang phải có sẵn của nó.
import { type ReactElement, useState } from "react";
import { feedbackLabels } from "../feedback/labels";
import { FeedbackPanel, type FeedbackPanelProps } from "./FeedbackPanel";

const BTN = {
  width: 36,
  height: 36,
  display: "grid",
  placeItems: "center",
  border: 0,
  borderRadius: 8,
  background: "transparent",
  color: "var(--muted-foreground, var(--dim, #6b7280))",
  cursor: "pointer",
} as const;

export function FeedbackButton(p: Omit<FeedbackPanelProps, "onClose">): ReactElement {
  const [open, setOpen] = useState(false);
  const t = feedbackLabels(p.lang);
  return (
    <>
      <button
        type="button"
        aria-label={t.open}
        title={t.open}
        onClick={() => setOpen(true)}
        style={BTN}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </button>
      {open && (
        <aside
          aria-label={t.title}
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 50,
            width: "min(420px, 100vw)",
            background: "var(--card, var(--panel, #fff))",
            borderLeft: "1px solid var(--border, #e5e5e5)",
            boxShadow: "-4px 0 16px rgba(0,0,0,.12)",
          }}
        >
          <FeedbackPanel {...p} onClose={() => setOpen(false)} />
        </aside>
      )}
    </>
  );
}
