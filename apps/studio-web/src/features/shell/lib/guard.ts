// HUB-FR-72 · H4a-R01, R02, R14 · guard route (plan-frontend D5, D6, §2): chưa phiên → /login?next=; `me` 403 → /forbidden
// (không gọi API cấu hình nào khác); 401 sau refresh → /login?next=. Lỗi mạng của `me` ném tiếp cho errorComponent.
import { redirect } from "@tanstack/react-router";
import { queryClient } from "#/app/query-client";
import { safeNext } from "#/lib/auth/next";
import { session } from "#/lib/auth/session";
import { withBase } from "#/lib/env";
import { ApiError } from "#/lib/http";
import { meQuery } from "../api";

type Loc = { href: string };

const toLogin = (location: Loc) =>
  redirect({ to: "/login", search: { next: safeNext(location.href) } });

export async function requireStudio(location: Loc): Promise<void> {
  if ((await session.ensure()) !== "authed") throw toLogin(location);
  try {
    await queryClient.ensureQueryData(meQuery);
  } catch (err) {
    if (err instanceof ApiError && err.status === 403) throw redirect({ to: "/forbidden" });
    if (err instanceof ApiError && err.status === 401) throw toLogin(location);
    throw err;
  }
}

/** Trang không quyền: chỉ cần có phiên (không gọi `me` lần nữa). */
export async function requireSession(location: Loc): Promise<void> {
  if ((await session.ensure()) !== "authed") throw toLogin(location);
}

/** `/login`: đã có phiên → `next` (đã kiểm) hoặc `/agents`. */
export async function redirectIfAuthed(next: string | undefined): Promise<void> {
  if ((await session.ensure()) !== "authed") return;
  const target = safeNext(next);
  throw target
    ? redirect({ href: withBase(target), replace: true })
    : redirect({ to: "/agents", replace: true });
}
