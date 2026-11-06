// CR-118 · manifest dữ liệu của app Community (key catalog `community`). Đối tác thấy Bảng tin và Bài của tôi (đăng bài cần mức Sửa).
import type { AppManifest } from "./manifest";

const POST_RECORD = { key: "post_id", label: { vi: "Bài đăng", en: "Post" } } as const;

export const COMMUNITY_MANIFEST: AppManifest = {
  key: "community",
  name: "Community",
  levelFeatures: {
    read: "community-read",
    write: "community-write",
    admin: "community-admin",
  },
  addons: [],
  nav: [
    {
      key: "feed",
      labelKey: "community.nav.feed",
      label: "Bảng tin",
      level: "read",
      partner: true,
      actions: [
        { key: "read", label: "Đọc bài và bình luận", level: "read", partner: true },
        { key: "post", label: "Đăng bài và bình luận", level: "write", partner: true },
      ],
    },
    {
      key: "myPosts",
      labelKey: "community.nav.myPosts",
      label: "Bài của tôi",
      level: "read",
      partner: true,
    },
    {
      key: "moderate",
      labelKey: "community.nav.moderate",
      label: "Duyệt bài và chuyên mục",
      level: "admin",
      audience: "company_admin",
    },
  ],
  // CR-120 §2 · §6: 3 khe luôn bật; def mặc định seed ở hub 0092 (lát cr120-community-flows) theo `defaultDefKey`.
  slots: [
    {
      key: "community.post-moderation",
      label: "Duyệt bài đăng",
      level: "write",
      purpose: "Sàng lọc bài mới; bài bị gắn cờ chờ quản trị community duyệt rồi mới hiện.",
      defaultDefKey: "community-post-moderation",
      allowedKinds: ["system", "review"],
      trigger: "post.created",
    },
    {
      key: "community.partner-join",
      label: "Đối tác xin tham gia",
      level: "write",
      purpose:
        "Công ty đối tác điền đơn xin tham gia; quản trị công ty duyệt rồi mới tạo liên kết.",
      defaultDefKey: "community-partner-join",
      allowedKinds: ["form", "review", "system"],
      trigger: "partner.join_requested",
    },
    {
      key: "community.report",
      label: "Báo cáo vi phạm",
      level: "read",
      purpose: "Phân loại báo cáo vi phạm rồi điều phối viên chọn ẩn, giữ hoặc cảnh báo.",
      defaultDefKey: "community-report",
      allowedKinds: ["system", "review"],
      trigger: "report.created",
    },
  ],
  // CR-122 · A · `record` = bản ghi của sự kiện (= `ref`). CR-122 · flow-model.md mục C · FLOW2-FR-18 (thay 3 khe trên). Brief F0: cả ba `decides` (kết quả đổi trạng thái bài/đơn/báo cáo).
  events: [
    {
      key: "post.created",
      label: "Khi đăng bài",
      record: POST_RECORD,
      facts: [
        { key: "post_kind", label: "Loại bài", type: "string" },
        { key: "author_is_partner", label: "Người đăng là đối tác", type: "boolean" },
      ],
      outcomes: [
        { key: "shown", label: "Hiện bài", effect: "Bài hiện trên Bảng tin." },
        { key: "hidden", label: "Ẩn bài", effect: "Bài bị ẩn, người đăng được báo." },
      ],
      decides: true,
      required: false,
    },
    {
      key: "partner.join_requested",
      label: "Khi có đối tác xin tham gia",
      record: { key: "join_id", label: { vi: "Đơn tham gia", en: "Join request" } },
      facts: [
        { key: "company_name", label: "Tên công ty", type: "string" },
        { key: "email_domain", label: "Tên miền email", type: "string" },
      ],
      outcomes: [
        { key: "accepted", label: "Nhận", effect: "Tạo liên kết đối tác." },
        { key: "rejected", label: "Từ chối", effect: "Đơn bị từ chối, người xin được báo." },
      ],
      decides: true,
      required: false,
    },
    {
      key: "report.created",
      label: "Khi có báo cáo vi phạm",
      record: { key: "report_id", label: { vi: "Báo cáo", en: "Report" } },
      facts: [
        { key: "report_kind", label: "Loại", type: "string" },
        { key: "severity", label: "Mức", type: "string" },
      ],
      outcomes: [
        { key: "hidden", label: "Ẩn", effect: "Nội dung bị ẩn." },
        { key: "kept", label: "Giữ", effect: "Nội dung giữ nguyên." },
        { key: "warned", label: "Cảnh báo", effect: "Người vi phạm nhận cảnh báo." },
      ],
      decides: true,
      required: false,
    },
  ],
  // CR-122 · N1 · FLOW2-FR-25 · "Hiện bài" = node Kết thúc đặt sẵn kết quả `shown` của `post.created` (app hiện bài qua OutcomeHandler).
  nodes: [
    {
      key: "community.show-post",
      label: { vi: "Hiện bài", en: "Show post" },
      group: "content",
      feature: "community-write",
      stages: [{ executor: { kind: "set", values: [] }, outcome: "shown" }],
      inputs: [{ key: "post_id", type: "string", required: true, label: POST_RECORD.label }],
      outputs: [],
    },
  ],
};
