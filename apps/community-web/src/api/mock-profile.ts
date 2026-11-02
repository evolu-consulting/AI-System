// CR-110 · COM-FR-37 · mock media hồ sơ + uy tín đối tác (cùng hình với server cr110-profile-api).
import {
  type CommunityViewer,
  isHost,
  type PartnerOrg,
  type PartnerReputation,
  type ProfileMedia,
} from "@ai/contracts/community";
import type { CommunityApi } from "./client";
import { HOST_ORG, PARTNERS, type RawComment, type RawPost } from "./seed";

/** Media của bài công ty `orgId` mà người xem thấy (`posts` đã lọc quyền xem), mới nhất trước, phân trang con trỏ = chỉ số. */
export function mediaPage(
  posts: RawPost[],
  orgId: string,
  q: { cursor?: string; limit?: number },
): ProfileMedia {
  const all = posts
    .filter((p) => p.authorOrgId === orgId)
    .sort((a, b) => a.createdMinAgo - b.createdMinAgo)
    .flatMap((p) =>
      p.media.map((m, i) => ({
        id: `${p.id}-m${i}`,
        postId: p.id,
        postType: p.type,
        kind: m.kind,
        label: m.label,
        createdAt: new Date(Date.now() - p.createdMinAgo * 60_000).toISOString(),
      })),
    );
  const start = q.cursor ? Number(q.cursor) || 0 : 0;
  const limit = q.limit ?? 30;
  const items = all.slice(start, start + limit);
  return { items, ...(start + limit < all.length ? { nextCursor: String(start + limit) } : {}) };
}

const REP: Record<string, PartnerReputation> = {
  tanphat: { band: "good", score: 92 },
  ncca: { band: "fair", score: 71 },
  abc: { band: "watch", score: 48 },
  hungthinh: { band: "new", score: null },
};
export const reputationOf = (orgId: string): PartnerReputation | undefined => REP[orgId];

/** `/partners` (đối tác chỉ thấy công ty mình; `rep` chỉ chủ quản có quyền contracts) + `/profile/:orgId/media`. */
export function profileMock(
  me: () => CommunityViewer,
  data: () => { posts: RawPost[]; comments: RawComment[] },
  visible: (p: RawPost) => boolean,
): Pick<CommunityApi, "listPartners" | "getProfileMedia" | "getProfile"> {
  return {
    listPartners: async (opts): Promise<PartnerOrg[]> => {
      const v = me();
      if (!isHost(v)) return PARTNERS.filter((p) => p.id === v.orgId);
      if (!opts?.rep || !v.caps.contracts) return PARTNERS;
      return PARTNERS.map((p) => ({ ...p, reputation: reputationOf(p.id) }));
    },
    getProfile: async (orgId) => {
      const v = me();
      const { posts, comments } = data();
      const id = isHost(v) ? (orgId ?? v.orgId) : v.orgId;
      const o =
        id === HOST_ORG.id
          ? { id, name: HOST_ORG.name, labels: [], cats: [] }
          : (PARTNERS.find((p) => p.id === id) as PartnerOrg);
      const mine = posts.filter((p) => p.authorOrgId === id);
      return {
        org: {
          ...o,
          isHost: id === HOST_ORG.id,
          blurb: id === HOST_ORG.id ? "Trung gian chữ ký số, hoá đơn điện tử, vật tư đóng gói" : "",
        },
        stats: {
          active: mine.filter((p) => p.status === "active").length,
          archived: mine.filter((p) => p.status !== "active").length,
          comments: comments.filter((c) => mine.some((p) => p.id === c.postId)).length,
          ...(id === HOST_ORG.id ? { friends: PARTNERS.length } : {}),
        },
        ...(isHost(v) && id === HOST_ORG.id ? { shtUrl: "/contracts" } : {}),
      };
    },
    getProfileMedia: async (orgId, q = {}) => {
      const v = me();
      const id = isHost(v) || v.orgId === orgId || orgId === HOST_ORG.id ? orgId : "";
      return mediaPage(data().posts.filter(visible), id, q);
    },
  };
}
