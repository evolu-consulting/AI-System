// CR-125 · m1 · khai báo node Hiện bài (chuyển từ `community.manifest.ts` — MỘT nguồn).
// CR-122 · N1 · FLOW2-FR-25 · "Hiện bài" = node Kết thúc đặt sẵn kết quả `shown` của `post.created` (app hiện bài qua OutcomeHandler).
import type { FeatureNodeDecl } from "../../types";

export const SHOW_POST_NODE: FeatureNodeDecl = {
  key: "community.show-post",
  label: { vi: "Hiện bài", en: "Show post" },
  group: "content",
  kind: "app",
  feature: "community-write",
  stages: [{ executor: { kind: "set", values: [] }, outcome: "shown" }],
  inputs: [
    { key: "post_id", type: "string", required: true, label: { vi: "Bài đăng", en: "Post" } },
  ],
  outputs: [],
};
