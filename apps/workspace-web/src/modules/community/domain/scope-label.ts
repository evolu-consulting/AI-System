// CR-193 · nhãn phạm vi ở đầu bài = «Ai thấy bài» thật của bài (BR-191-7), không suy từ bên đăng.
import type { PostAudience, PostType } from "@ai/contracts/community";
import { t } from "../i18n";
import { audienceSummary } from "./audience";

/** Bài đối tác ⇒ chỉ chủ quản thấy ⇒ «Chỉ nội bộ». Bài chủ quản ⇒ chế độ «Ai thấy bài» (người xem đối tác không nhận `audience` ⇒ không hiện nhãn). */
export function scopeLabel(p: {
  authorSide: "host" | "partner";
  type: PostType;
  audience?: PostAudience | undefined;
}): string | null {
  if (p.authorSide !== "host") return t("community.post.hostOnly");
  return p.audience ? audienceSummary(p.audience, p.type) : null; // người xem không phải chủ quản không nhận `audience` ⇒ không nói sai
}
