// CR-102 · C5 · điểm vào community-web. Adapter API dựng trước khi vẽ (mock nạp động chỉ ở dev — review Thấp-12).
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { createApi } from "./api";
import { App } from "./ui/App";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");
const root = createRoot(el);
createApi().then((boot) =>
  root.render(
    <StrictMode>
      <App boot={boot} />
    </StrictMode>,
  ),
);
