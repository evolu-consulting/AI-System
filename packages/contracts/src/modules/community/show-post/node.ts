// CR-125 · m1 · khai báo node Hiện bài (chuyển từ `community.manifest.ts` — MỘT nguồn).
// CR-122 · N1 · FLOW2-FR-25 · "Hiện bài" = node Kết thúc đặt sẵn kết quả `shown` của `post.created` (app hiện bài qua OutcomeHandler).
import type { FeatureNodeDecl } from "../../types";

export const SHOW_POST_NODE: FeatureNodeDecl = {
  key: "community.show-post",
  label: { vi: "Hiện bài", en: "Show post" },
  group: "content",
  kind: "app",
  feature: "community-write",
  // CR-125 · c6 · B3: bước nghiệp vụ của community ⇒ quản trị công ty thấy ngay ở menu "+" (không chui vào "Nâng cao").
  menu: { section: "business", order: 55 },
  stages: [{ executor: { kind: "set", values: [] }, outcome: "shown" }],
  inputs: [
    {
      key: "post_id",
      type: "string",
      required: true,
      label: { vi: "Bài đăng", en: "Post" },
      fix: {
        vi: "bắt đầu quy trình từ sự kiện «Khi đăng bài».",
        en: "start the flow from the «When a post is created» event.",
      },
    },
  ],
  // CR-125 · m8 · Hiện bài là bước cuối (kết quả `shown` do app xử lý), không có cổng ra cho bước sau.
  outputs: [],
};
