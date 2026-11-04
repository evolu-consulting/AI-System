// Nút nổi "Hỏi trợ lý giá" + khung chat (mockup `.fab` / `.chat`), C10b: nối trợ lý chung `assistant` qua Agent Hub (SSE,
// surface=community) + ngữ cảnh trang. Chỉ chủ quản nội bộ; đối tác không thấy nút (GĐ1: không chatbot đối tác).
import { useState } from "react";
import { useApp } from "../application/ctx";
import { ask, stop, useDock } from "../application/use-dock";
import { dockContext, dockSuggestions, dockVisible, QUESTION_MAX } from "../domain/dock";
import { t } from "../i18n";
import { IconChat, IconSend, IconX } from "./icons";

export function ChatDock() {
  const { viewer, api, route, search } = useApp();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const { msgs } = useDock();
  if (!dockVisible(viewer.role)) return null;
  const busy = msgs.some((m) => m.pending);
  const send = (q: string) => {
    if (busy || !q.trim()) return;
    setText("");
    void ask(api, q, dockContext({ route: route.name, orgId: route.orgId, search }));
  };
  return (
    <>
      {open && (
        <div className="chat" role="dialog" aria-label={t("community.dock.title")}>
          <div className="hd">
            <span className="logo" style={{ width: 32, height: 32, fontSize: 14 }}>
              AI
            </span>
            <div style={{ flex: 1 }}>
              <b>{t("community.dock.title")}</b>
              <span>{t("community.dock.subtitle")}</span>
            </div>
            <button
              type="button"
              className="iconbtn"
              style={{ width: 40, height: 40 }}
              onClick={() => setOpen(false)}
              aria-label={t("community.dock.close")}
            >
              <IconX />
            </button>
          </div>
          <div className="msgs" aria-live="polite">
            {msgs.length === 0 && <div className="msg bot">{t("community.dock.welcome")}</div>}
            {msgs.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ thêm cuối
                key={i}
                className={`msg ${m.role === "user" ? "me" : "bot"}${m.error ? " err" : ""}`}
              >
                {m.error ??
                  (m.text || (m.pending ? (m.step ?? t("community.dock.searching")) : ""))}
              </div>
            ))}
          </div>
          <div className="qp">
            {dockSuggestions().map((q) => (
              <button key={q} type="button" disabled={busy} onClick={() => send(q)}>
                {q}
              </button>
            ))}
          </div>
          <form
            className="in"
            onSubmit={(e) => {
              e.preventDefault();
              send(text);
            }}
          >
            <input
              aria-label={t("community.dock.inputLabel")}
              placeholder={t("community.dock.inputPlaceholder")}
              value={text}
              maxLength={QUESTION_MAX}
              onChange={(e) => setText(e.target.value)}
            />
            {busy ? (
              <button
                type="button"
                className="sendbtn"
                onClick={() => void stop(api)}
                aria-label={t("community.dock.stop")}
              >
                <IconX size={16} />
              </button>
            ) : (
              <button
                type="submit"
                className="sendbtn"
                disabled={!text.trim()}
                aria-label={t("community.dock.send")}
              >
                <IconSend size={16} />
              </button>
            )}
          </form>
        </div>
      )}
      <button
        type="button"
        className="fab"
        onClick={() => setOpen(!open)}
        aria-label={t("community.dock.open")}
      >
        <IconChat size={20} />
        {t("community.dock.fab")}
      </button>
    </>
  );
}
