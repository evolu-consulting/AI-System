// CR-102 · C5 · điểm vào community-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles/globals.css";
import { App } from "./ui/App";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");
createRoot(el).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
