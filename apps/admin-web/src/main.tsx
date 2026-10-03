// ADM-NFR-06 · điểm vào admin-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { boot, renderBootError } from "./app/boot";
import { Providers } from "./app/providers";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");

// Chờ bản dịch đang dùng nạp xong rồi mới vẽ (không nháy key); thiếu bản dịch → màn lỗi có nút tải lại.
void boot(
  () => {
    createRoot(el).render(
      <StrictMode>
        <Providers />
      </StrictMode>,
    );
  },
  () => renderBootError(el),
);
