// C1 FE · route gốc: chỉ chứa Outlet (guard đăng nhập ở `_authed`, F3).
import { createRootRoute, Outlet } from "@tanstack/react-router";

export const Route = createRootRoute({ component: Outlet });
