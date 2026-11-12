// CR-125 · m1 · khai báo node Hiện bài (chuyển từ `community.manifest.ts` — MỘT nguồn).
// CR-122 · N1 · FLOW2-FR-25 · "Hiện bài" = node Kết thúc đặt sẵn kết quả `shown` của `post.created` (app hiện bài qua OutcomeHandler).
import type { FeatureNodeDecl } from "../../types";

export const SHOW_POST_NODE: FeatureNodeDecl = {
  key: "community.show-post",
  label: { vi: "Hiện bài", en: "Show post" },
  group: "content",
  kind: "app",
  feature: "contracts-community", // ADR-0044: add-on Bảng tin của gói contracts (không còn `community-write`)
  // CR-125 · c6b · KHÔNG khai `menu`: "Hiện bài" chỉ là Kết thúc đặt sẵn kết quả `shown` — menu "+" đã có "Kết thúc · Hiện bài" (từ `outcomes`
  // của sự kiện), nên node này không hiện thêm một lối thứ hai. Vẫn đăng ký ở sổ MODULES vì flow đã lưu có thể mang khoá node này.
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
