// C1 FE · điểm vào chat-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { initI18n } from "./app/i18n";
import { Providers } from "./app/providers";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");
const root = el;

const render = () =>
  createRoot(root).render(
    <StrictMode>
      <Providers />
    </StrictMode>,
  );

// Chờ bản dịch đang dùng nạp xong rồi mới vẽ (không nháy key); nạp hỏng vẫn vẽ (i18next trả key).
initI18n().then(render, render);
