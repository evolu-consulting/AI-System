// ADM-FR-01, ADM-FR-03 · guard của route `_authed`: chưa có phiên → /login?next=…; member chỉ được /member và /account/password.
import { redirect } from "@tanstack/react-router";
import { session } from "@/lib/auth/session";
import { frozenModulesOn } from "@/lib/frozen";
import { isAllowedForRole, isFrozenPath } from "./nav";

type Loc = { pathname: string; href: string };

export async function requireSession(location: Loc): Promise<void> {
  const status = await session.ensure();
  const me = session.getState().me;
  if (status !== "authed" || !me) {
    throw redirect({ to: "/login", search: { next: location.href } });
  }
  if (!isAllowedForRole(me.role, location.pathname)) throw redirect({ to: "/member" });
  // F1 (CR-095): module đóng băng (Commands, Workflows, Transfer, Quy trình, Nguồn) — cờ off ⇒ về tổng quan.
  if (!frozenModulesOn && isFrozenPath(location.pathname)) throw redirect({ to: "/" });
}

/** Trang công khai (login): đã đăng nhập thì về nơi làm việc của role. */
export async function redirectIfAuthed(): Promise<void> {
  const status = await session.ensure();
  const me = session.getState().me;
  if (status === "authed" && me) throw redirect({ to: me.role === "member" ? "/member" : "/" });
}
