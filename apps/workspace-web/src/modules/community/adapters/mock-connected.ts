// CR-191 · bài công ty đã kết nối trong mock (chỉ xem, đã che liên hệ). 2 công ty × 14 bài, cũ hơn mọi bài seed ⇒ nằm sau bài công ty mình.
import type { PostView } from "@ai/contracts/community";
import type { ConnectedCompany } from "../application/ports";

export const MOCK_CONNECTED: ConnectedCompany[] = [
  { id: "c0000000-0000-4000-8000-00000000000a", name: "Công ty Thép Đại Phát" },
  { id: "c0000000-0000-4000-8000-00000000000b", name: "Công ty Bao Bì Việt Tiến" },
];

const TYPES = ["sell", "buy", "note"] as const;

export function mockConnectedPosts(): PostView[] {
  return MOCK_CONNECTED.flatMap((c, ci) =>
    Array.from({ length: 14 }, (_, i): PostView => {
      const type = TYPES[i % 3] as (typeof TYPES)[number];
      const mins = 8 * 1440 + i * 90 + ci * 45;
      return {
        id: `cx-${ci}-${i}`,
        type,
        authorOrgId: c.id,
        authorOrgName: c.name,
        authorName: ci === 0 ? "Phạm Văn An" : "Đỗ Thị Bình",
        authorTitle: ci === 0 ? "Trưởng phòng kinh doanh" : "Chuyên viên mua hàng",
        authorSide: "partner",
        source: "connected",
        fileCount: i % 4 === 0 ? 2 : 0,
        createdAt: new Date(Date.now() - mins * 60_000).toISOString(),
        edited: false,
        status: "active",
        title: `Bài đối tác ${ci + 1}-${i + 1}`,
        body: `Nội dung bài của ${c.name} (chỉ xem).`,
        fields: {},
        cats: [],
        media: [],
        commentCount: 0,
        recentComments: [],
        actions: [],
      };
    }),
  );
}
