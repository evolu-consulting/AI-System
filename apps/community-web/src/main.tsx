// CR-102 · C5 · điểm vào community-web. Adapter API dựng trước khi vẽ (mock nạp động chỉ ở dev — review Thấp-12).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { createApi } from "./api";
import { initLang } from "./i18n";
import { App } from "./ui/App";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root"); // i18n-ignore: lỗi lập trình
const root = createRoot(el);
Promise.all([createApi(), initLang()]).then(([boot]) =>
  root.render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  ),
);
