// ADM-FR-10 · M2 · guard cho trang danh mục: chỉ platform_admin; vai khác thấy ForbiddenState (không redirect, không gọi API).
import type { ReactNode } from "react";
import { useSession } from "@/lib/auth/use-session";
import { ForbiddenState } from "./states/ForbiddenState";

export function PlatformOnly({ children }: { children: ReactNode }) {
  const role = useSession((s) => s.me?.role);
  return role === "platform_admin" ? <>{children}</> : <ForbiddenState />;
}
