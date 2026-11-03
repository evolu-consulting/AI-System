// CR-112 · ADM-FR-78 · nội dung hộp xác nhận lưu tab "Ứng dụng & Gói": cảnh báo TẮT gói (người dùng mất quyền vào app, kèm số người)
// + danh sách tên thân thiện của mọi quyền sẽ bị thu hồi. Rỗng ⇒ không cần xác nhận.
import type { Translate } from "@/lib/format";
import type { AppsPlan, PackInfo } from "./apps-plan";
import { revokeMessage } from "./revoke-message";

export const needsConfirm = (p: AppsPlan): boolean =>
  p.disablePacks.length > 0 || p.revokeShown.length > 0;

export function appsConfirmMessage(
  tr: Translate,
  lang: string,
  plan: AppsPlan,
  packs: readonly PackInfo[],
  appName: (packKey: string) => string,
): string {
  const parts: string[] = [];
  if (plan.disablePacks.length > 0) {
    const members = plan.disablePacks.reduce(
      (n, k) => n + (packs.find((p) => p.key === k)?.member_count ?? 0),
      0,
    );
    parts.push(
      tr("tenants.apps.confirmPackOff", {
        list: plan.disablePacks.map(appName).join(", "),
        members,
      }),
    );
  }
  if (plan.revokeShown.length > 0) parts.push(revokeMessage(tr, lang, plan.revokeShown));
  return parts.join(" ");
}
