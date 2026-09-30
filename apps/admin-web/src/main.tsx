// ADM-NFR-06 · điểm vào admin-web.
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

const el = document.getElementById("root");
if (!el) throw new Error("Thiếu phần tử #root");

createRoot(el).render(<StrictMode />);
