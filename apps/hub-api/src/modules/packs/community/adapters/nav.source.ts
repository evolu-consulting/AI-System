// CR-121 C-7 · nguồn mục hàng việc của Community cho `GET /pack/nav` (kit): vai + khe đã bật + số chờ, tính MỘT lần (số đếm 1 câu SQL
// trong tx gói, RLS tenant + lọc `tenant_id` tường minh; chỉ đếm khi là người duyệt). Cùng luật với `GET /flows/nav` (một nguồn `reviewer`).

import type { ExternalOrgResolver, PackAccessView, PackNavSource } from "../../kit/public";
import { accessOfUser, COMMUNITY_KEY } from "./community-access";
import * as svc from "./flows.service";

export function communityNavSource(
  view: PackAccessView,
  resolver: ExternalOrgResolver,
  f: svc.FlowDeps,
): PackNavSource {
  return {
    pack: COMMUNITY_KEY,
    async caps(user) {
      const a = await accessOfUser(view, resolver, user); // 403 (không quyền / đối tác bị khoá) ⇒ route nuốt ⇒ không mục
      const rev = svc.reviewer(a);
      const [on, n] = await Promise.all([
        svc.moderationEnabled(f, a.who.tenantId),
        svc.navCounts(f, a),
      ]);
      return [
        ...(rev && on ? [{ cap: "community.review", count: n.review }] : []),
        ...(a.org !== null || svc.joinReviewer(a)
          ? [{ cap: "community.join", count: n.join }]
          : []),
        ...(rev ? [{ cap: "community.reports", count: n.reports }] : []),
      ];
    },
  };
}
