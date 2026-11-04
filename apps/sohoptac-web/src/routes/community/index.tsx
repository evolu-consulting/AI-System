// CR-118 · `/community` (Bảng tin): route con rỗng — trang do module Community vẽ (xem routes/community.tsx).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/community/")();
