// CR-102 · C5 · điểm vào community-web. Adapter API dựng trước khi vẽ (mock nạp động chỉ ở dev — review Thấp-12).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./app/globals.css";
import { App } from "./app/App";
import { createApi } from "./modules/community/application/runtime";
import { initLang } from "./modules/community/i18n";

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
