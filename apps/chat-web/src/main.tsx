// C1 FE · điểm vào chat-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { Providers } from "./app/providers";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");

createRoot(el).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
);
