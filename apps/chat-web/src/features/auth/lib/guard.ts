// CHAT-AC-01, CHAT-AC-04 · guard route: `_authed` cần phiên (tải trang → refresh cookie một lần), `/login` đã đăng nhập → `/c/new`.
import { redirect } from "@tanstack/react-router";
import { session } from "~/lib/auth/session";

type Loc = { href: string };

export async function requireSession(location: Loc): Promise<void> {
  const status = await session.ensure();
  if (status !== "authed" || !session.getState().me) {
    throw redirect({ to: "/login", search: { next: location.href } });
  }
}

export async function redirectIfAuthed(): Promise<void> {
  const status = await session.ensure();
  if (status === "authed" && session.getState().me) throw redirect({ to: "/c/new" });
}
