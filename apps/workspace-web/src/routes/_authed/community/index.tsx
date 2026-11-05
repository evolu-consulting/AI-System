// CR-118 · `/community` (Bảng tin): route con rỗng — trang do module Community vẽ (xem routes/_authed/community.tsx).
import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authed/community/")({});
