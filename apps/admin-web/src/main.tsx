// ADM-NFR-06 · điểm vào admin-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { initI18n } from "./app/i18n";
import { Providers } from "./app/providers";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");

// Chờ bản dịch đang dùng nạp xong rồi mới vẽ (không nháy key).
void initI18n().then(() => {
  createRoot(el).render(
    <StrictMode>
      <Providers />
    </StrictMode>,
  );
});
