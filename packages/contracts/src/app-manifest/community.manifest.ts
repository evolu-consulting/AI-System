// CR-118 · manifest dữ liệu của app Community (key catalog `community`). Đối tác thấy Bảng tin và Bài của tôi (đăng bài cần mức Sửa).
import type { AppManifest } from "./manifest";

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
  slots: [],
};
