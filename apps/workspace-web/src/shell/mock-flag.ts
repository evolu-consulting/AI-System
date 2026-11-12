// CR-120 · cờ bản dựng mock Community (`PUBLIC_COMMUNITY_API=mock`, dev/e2e không backend) — MỘT nguồn cho community-host và modules.
// Bản mock không có `/pack/me` ⇒ không có cờ từ máy chủ: Bảng tin phải mặc định BẬT ngay từ đầu (trước khi trang Community mount và
// báo nhân vật), nếu không `CommunityRoute` luôn hiện «Bảng tin chưa được bật». Bản http: luôn false ⇒ không đổi gì.
declare const __COMMUNITY_MOCK__: boolean | undefined;
export const COMMUNITY_MOCK: boolean =
  typeof __COMMUNITY_MOCK__ !== "undefined" && __COMMUNITY_MOCK__;
