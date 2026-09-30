// ADM-NFR-06 · điểm vào admin-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import "./app/i18n";
import { Providers } from "./app/providers";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");

createRoot(el).render(
  <StrictMode>
    <Providers />
  </StrictMode>,
);
