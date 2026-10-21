// feedback · nút nổi + ngăn kéo cho web chưa có nút "Góp ý" trên thanh trên (Chat AI, Admin, Studio). Không đụng bố cục thanh trên.
import { type ReactElement, useState } from "react";
import { feedbackLabels } from "../feedback/labels";
import { FeedbackPanel, type FeedbackPanelProps } from "./FeedbackPanel";

export function FeedbackFab({
  bottom = 16,
  ...p
}: Omit<FeedbackPanelProps, "onClose"> & { bottom?: number }): ReactElement {
  const [open, setOpen] = useState(false);
  const t = feedbackLabels(p.lang);
  return (
    <>
      <button
        type="button"
        aria-label={t.open}
        title={t.open}
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          right: 16,
          bottom,
          zIndex: 40,
          width: 44,
          height: 44,
          borderRadius: "50%",
          border: "1px solid var(--border, #e5e5e5)",
          background: "var(--card, #fff)",
          color: "var(--foreground, #111)",
          boxShadow: "0 2px 8px rgba(0,0,0,.15)",
          cursor: "pointer",
          fontSize: 20,
        }}
      >
        💬
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
