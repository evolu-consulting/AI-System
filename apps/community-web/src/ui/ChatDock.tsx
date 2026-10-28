// Nút nổi "Hỏi trợ lý giá" + khung chat (mockup `.fab` / `.chat`), C10b: nối trợ lý chung `assistant` qua Agent Hub (SSE,
// surface=community) + ngữ cảnh trang. Chỉ chủ quản nội bộ; đối tác không thấy nút (GĐ1: không chatbot đối tác).
import { useState } from "react";
import { DOCK_SUGGESTIONS, dockContext, dockVisible, QUESTION_MAX } from "../lib/dock";
import { useApp } from "./ctx";
import { IconChat, IconSend, IconX } from "./icons";
import { ask, stop, useDock } from "./use-dock";

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
        <div className="chat" role="dialog" aria-label="Trợ lý giá">
          <div className="hd">
            <span className="logo" style={{ width: 32, height: 32, fontSize: 14 }}>
              AI
            </span>
            <div style={{ flex: 1 }}>
              <b>Trợ lý giá</b>
              <span>Trả lời từ Sổ giá, bài đăng và báo giá · luôn kèm nguồn</span>
            </div>
            <button
              type="button"
              className="iconbtn"
              style={{ width: 40, height: 40 }}
              onClick={() => setOpen(false)}
              aria-label="Đóng trợ lý"
            >
              <IconX />
            </button>
          </div>
          <div className="msgs" aria-live="polite">
            {msgs.length === 0 && (
              <div className="msg bot">
                Hỏi giá một sản phẩm, so sánh nhà cung cấp hoặc xem hôm nay có gì mới. Mỗi con số
                đều kèm nguồn và ngày.
              </div>
            )}
            {msgs.map((m, i) => (
              <div
                // biome-ignore lint/suspicious/noArrayIndexKey: danh sách chỉ thêm cuối
                key={i}
                className={`msg ${m.role === "user" ? "me" : "bot"}${m.error ? " err" : ""}`}
              >
                {m.error ?? (m.text || (m.pending ? (m.step ?? "Đang tra…") : ""))}
              </div>
            ))}
          </div>
          <div className="qp">
            {DOCK_SUGGESTIONS.map((q) => (
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
              aria-label="Hỏi trợ lý giá"
              placeholder="Hỏi giá, ghi giá, soạn báo giá…"
              value={text}
              maxLength={QUESTION_MAX}
              onChange={(e) => setText(e.target.value)}
            />
            {busy ? (
              <button
                type="button"
                className="sendbtn"
                onClick={() => void stop(api)}
                aria-label="Dừng"
              >
                <IconX size={16} />
              </button>
            ) : (
              <button type="submit" className="sendbtn" disabled={!text.trim()} aria-label="Gửi">
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
        aria-label="Mở trợ lý giá"
      >
        <IconChat size={20} />
        Hỏi trợ lý giá
      </button>
    </>
  );
}
