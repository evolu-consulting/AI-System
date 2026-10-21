// feedback · nhãn dựng sẵn vi/en cho khung "Góp ý về app" dùng chung (web-kit không phụ thuộc i18n của từng app).
export type FeedbackLang = "vi" | "en";

const VI = {
  title: "Góp ý về app",
  close: "Đóng",
  tabNew: "Gửi góp ý",
  tabMine: "Đã gửi",
  kind: "Loại",
  kind_bug: "Lỗi",
  kind_idea: "Đề xuất",
  kind_other: "Khác",
  message: "Nội dung",
  messagePh: "Chuyện gì xảy ra, ở màn hình nào, anh/chị mong app làm gì…",
  attach: "Đính kèm ảnh chụp / tệp (tối đa 3, mỗi tệp 2 MB)",
  remove: "Bỏ",
  context: "Tự đính kèm: trang hiện tại, app và phiên bản.",
  send: "Gửi góp ý",
  sending: "Đang gửi…",
  thanks: "Cảm ơn anh/chị! Góp ý đã được gửi tới nhóm quản trị.",
  sendMore: "Gửi thêm",
  empty: "Chưa có góp ý nào.",
  loading: "Đang tải…",
  reply: "Phản hồi",
  noReply: "Chưa có phản hồi",
  status_new: "Mới",
  status_in_progress: "Đang xử lý",
  status_done: "Xong",
  errEmpty: "Hãy ghi nội dung góp ý.",
  errFile: "Tệp phải là ảnh PNG/JPG/WebP/GIF, PDF hoặc văn bản, tối đa 2 MB, tối đa 3 tệp.",
  errSend: "Không gửi được, thử lại sau.",
  open: "Góp ý về app",
};

export type FeedbackLabels = typeof VI;

const EN: FeedbackLabels = {
  title: "App feedback",
  close: "Close",
  tabNew: "Send feedback",
  tabMine: "Sent",
  kind: "Type",
  kind_bug: "Bug",
  kind_idea: "Suggestion",
  kind_other: "Other",
  message: "Message",
  messagePh: "What happened, on which screen, what you expect the app to do…",
  attach: "Attach a screenshot / file (up to 3, 2 MB each)",
  remove: "Remove",
  context: "Attached automatically: current page, app and version.",
  send: "Send feedback",
  sending: "Sending…",
  thanks: "Thank you! Your feedback was sent to the admin team.",
  sendMore: "Send more",
  empty: "No feedback yet.",
  loading: "Loading…",
  reply: "Reply",
  noReply: "No reply yet",
  status_new: "New",
  status_in_progress: "In progress",
  status_done: "Done",
  errEmpty: "Please write your feedback.",
  errFile: "Files must be PNG/JPG/WebP/GIF images, PDF or text, max 2 MB each, up to 3 files.",
  errSend: "Could not send, try again later.",
  open: "App feedback",
};

export const feedbackLabels = (lang: string | undefined): FeedbackLabels =>
  lang?.toLowerCase().startsWith("en") ? EN : VI;
