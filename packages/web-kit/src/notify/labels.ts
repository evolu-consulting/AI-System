// gap-c · nhãn mặc định (tiếng Việt) của chuông + trang thông báo; app truyền `labels` từng phần để dịch/đổi.
export type NotifyLabels = {
  bell: string;
  bellUnread: (n: number) => string;
  title: string;
  empty: string;
  readAll: string;
  viewAll: string;
  settings: string;
  loadMore: string;
  loading: string;
  failed: string;
  unreadDot: string;
  prefsTitle: string;
  channels: string;
  email: string;
  push: string;
  pushTest: string;
  pushTestSent: string;
  pushTestWait: string;
  pushDenied: string;
  pushInsecure: string;
  pushUnsupported: string;
  pushNoKey: string;
  pushError: string;
  remindDays: string;
  remindDaysHint: string;
  remindDaysDefault: string;
  remindDaysCustom: string;
  daysBefore: (d: number) => string;
  alerts: string;
  priceAlerts: string;
  includeManaged: string;
  saved: string;
};

export const VI_LABELS: NotifyLabels = {
  bell: "Thông báo",
  bellUnread: (n) => `Thông báo (${n} chưa đọc)`,
  title: "Thông báo",
  empty: "Chưa có thông báo nào.",
  readAll: "Đánh dấu tất cả đã đọc",
  viewAll: "Xem tất cả",
  settings: "Cài đặt thông báo",
  loadMore: "Tải thêm",
  loading: "Đang tải…",
  failed: "Không tải được. Thử lại sau.",
  unreadDot: "Chưa đọc",
  prefsTitle: "Cài đặt thông báo",
  channels: "Nhận thông báo qua",
  email: "Email",
  push: "Thông báo đẩy trên trình duyệt",
  pushTest: "Gửi thử",
  pushTestSent: "Đã gửi thông báo thử.",
  pushTestWait: "Vừa gửi thử, chờ vài giây rồi thử lại.",
  pushDenied: "Trình duyệt đã chặn thông báo. Hãy cho phép trong cài đặt trang web.",
  pushInsecure: "Thông báo đẩy chỉ hoạt động trên kết nối HTTPS.",
  pushUnsupported: "Trình duyệt này không hỗ trợ thông báo đẩy.",
  pushNoKey: "Máy chủ chưa cấu hình thông báo đẩy.",
  pushError: "Không bật được thông báo đẩy. Thử lại sau.",
  remindDays: "Nhắc hạn hợp đồng trước",
  remindDaysHint: "Chọn các mốc muốn nhận nhắc hạn hành động.",
  remindDaysDefault: "Dùng mặc định của công ty",
  remindDaysCustom: "Chọn riêng",
  daysBefore: (d) => (d === 0 ? "Đúng hạn" : `${d} ngày`),
  alerts: "Cảnh báo khác",
  priceAlerts: "Cảnh báo giá (dò giá, giá hết hạn)",
  includeManaged: "Nhận cả nhắc hạn hợp đồng của người tôi quản lý",
  saved: "Đã lưu.",
};

export const mergeLabels = (l?: Partial<NotifyLabels>): NotifyLabels => ({ ...VI_LABELS, ...l });
