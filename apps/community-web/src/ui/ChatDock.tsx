// Nút nổi "Hỏi trợ lý giá" + khung chat (mockup `.fab` / `.chat`). Placeholder: lát C10 nối trợ lý; đối tác không có chatbot (GĐ1).
import { useState } from "react";
import { useApp } from "./ctx";
import { IconChat, IconSend, IconX } from "./icons";

export function ChatDock() {
  const { isHostViewer } = useApp();
  const [open, setOpen] = useState(false);
  if (!isHostViewer) return null;
  return (
    <>
      {open && (
        <div className="chat" role="dialog" aria-label="Trợ lý giá">
          <div className="hd">
            <span className="logo" style={{ width: 32, height: 32, fontSize: 14 }}>
              AI
            </span>
            <div style={{ flex: 1 }}>
              <b>
                Trợ lý giá<span className="soonpill">sắp có</span>
              </b>
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
          <div className="msgs">
            <div className="msg bot">
              Trợ lý giá sẽ trả lời giá từ Sản phẩm &amp; Giá, kèm nguồn và ngày. Tính năng này chưa
              bật.
            </div>
          </div>
          <div className="qp">
            {["Giá chữ ký số USB Token?", "Hôm nay có gì mới?"].map((q) => (
              <button key={q} type="button" disabled>
                {q}
              </button>
            ))}
          </div>
          <div className="in">
            <input
              aria-label="Hỏi trợ lý giá"
              placeholder="Hỏi giá, ghi giá, soạn báo giá…"
              disabled
            />
            <button type="button" className="sendbtn" disabled aria-label="Gửi">
              <IconSend size={16} />
            </button>
          </div>
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
