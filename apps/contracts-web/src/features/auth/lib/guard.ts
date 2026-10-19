// PK-FR-10 · TF4 · guard route (plan-frontend §1): `_authed` cần phiên (tải trang → refresh cookie một lần, không có ⇒
// `/login?next=`); vào `/login` khi đã có phiên ⇒ `/contracts`.
import { redirect } from "@tanstack/react-router";
import { session } from "./session";

type Loc = { href: string };

export async function requireSession(location: Loc): Promise<void> {
  const status = await session.ensure();
  if (status !== "authed" || !session.getState().me) {
    throw redirect({ to: "/login", search: { next: location.href } });
  }
}

export async function redirectIfAuthed(): Promise<void> {
  const status = await session.ensure();
  if (status === "authed" && session.getState().me) throw redirect({ to: "/contracts" });
}
