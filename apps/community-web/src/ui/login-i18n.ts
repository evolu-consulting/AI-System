// Bảng dịch VI/EN tự chứa cho màn Đăng nhập (LoginPage vẽ ngoài AppProvider nên không dùng i18n của app).
export type Lang = "vi" | "en";

const LANG_KEY = "community:lang";

export function readLang(): Lang {
  try {
    return localStorage.getItem(LANG_KEY) === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

export function saveLang(l: Lang): void {
  try {
    localStorage.setItem(LANG_KEY, l);
  } catch {
    /* storage bị chặn */
  }
  document.documentElement.lang = l;
}

export interface LoginText {
  loginTitle: string;
  loginLead: string;
  loginSubmit: string;
  changeTitle: string;
  changeLead: string;
  changeSubmit: string;
  totpTitle: string;
  totpLead: string;
  totpSubmit: string;
  tenant: string;
  tenantHint: string;
  username: string;
  usernamePh: string;
  password: string;
  newPassword: string;
  confirmPassword: string;
  code: string;
  showPw: string;
  hidePw: string;
  forgot: string;
  ssoPrefix: string;
  ssoLink: string;
  footer: string;
  showTitle: string;
  showDesc: string;
  chip1: string;
  chip2: string;
  chip3: string;
  stat1: string;
  stat2Num: string;
  stat2: string;
  stat3: string;
  f1: string;
  f1d: string;
  f2: string;
  f2d: string;
  f3: string;
  f3d: string;
  quote: string;
  winTitle: string;
  p1When: string;
  p1Pill: string;
  p1Title: string;
  p1Ask: string;
  p1Qty: string;
  p1QtyV: string;
  p1Area: string;
  p2When: string;
  p2Pill: string;
  p2Title: string;
  p2Budget: string;
  p2Need: string;
  p2NeedV: string;
  p2To: string;
  p3Name: string;
  p3When: string;
  p3Pill: string;
  p3Title: string;
}

const vi: LoginText = {
  loginTitle: "Đăng nhập",
  loginLead: "Cộng đồng đối tác — dùng tài khoản do bên chủ quản cấp.",
  loginSubmit: "Đăng nhập",
  changeTitle: "Đặt mật khẩu mới",
  changeLead: "Lần đăng nhập đầu tiên: hãy đổi mật khẩu tạm thành mật khẩu của riêng bạn.",
  changeSubmit: "Lưu mật khẩu",
  totpTitle: "Xác thực hai bước",
  totpLead: "Nhập mã 6 số trong ứng dụng xác thực (hoặc mã dự phòng).",
  totpSubmit: "Xác nhận",
  tenant: "Mã công ty",
  tenantHint: "do chủ quản cung cấp",
  username: "Tên đăng nhập",
  usernamePh: "vd. nguyenvanbay",
  password: "Mật khẩu",
  newPassword: "Mật khẩu mới",
  confirmPassword: "Nhập lại mật khẩu mới",
  code: "Mã xác thực",
  showPw: "Hiện mật khẩu",
  hidePw: "Ẩn mật khẩu",
  forgot: "Quên mật khẩu? Liên hệ bên chủ quản để được cấp lại.",
  ssoPrefix: "Nhân viên bên chủ quản? ",
  ssoLink: "Đăng nhập bằng tài khoản AI System",
  footer: "© Evolu Consulting · Cộng đồng đối tác",
  showTitle: "Nơi đối tác gặp nhu cầu",
  showDesc:
    "Đăng tin cần bán, cần mua và trao đổi báo giá với các đối tác trong chợ — tất cả ở một bảng tin.",
  chip1: "Cần bán · Cần mua · Thông báo",
  chip2: "Báo giá & khớp đối tác",
  chip3: "Riêng tư theo chủ quản",
  stat1: "đối tác trong chợ",
  stat2Num: "2.400",
  stat2: "tin đã đăng",
  stat3: "khớp mới hôm nay",
  f1: "Đăng tin cần bán / cần mua",
  f1d: "Soạn trong một phút, kèm giá và số lượng.",
  f2: "Báo giá riêng tư",
  f2d: "Chỉ đối tác bạn chọn thấy mức giá bạn gửi.",
  f3: "Khớp cung – cầu",
  f3d: "Gợi ý đối tác phù hợp với tin của bạn mỗi ngày.",
  quote: "“Nhờ bảng tin chung, chúng tôi chốt lô xoài 8 tấn chỉ sau một buổi chiều.”",
  winTitle: "Bảng tin — Chợ đối tác",
  p1When: "2 giờ trước · Chỉ chủ quản",
  p1Pill: "Cần bán",
  p1Title: "Xoài cát Hòa Lộc loại 1",
  p1Ask: "Giá chào",
  p1Qty: "Số lượng",
  p1QtyV: "8 tấn",
  p1Area: "Khu vực",
  p2When: "5 giờ trước · Bạn bè",
  p2Pill: "Cần mua",
  p2Title: "Thu mua chanh dây cấp đông",
  p2Budget: "Ngân sách",
  p2Need: "Cần",
  p2NeedV: "15 tấn/th",
  p2To: "Giao tại",
  p3Name: "Ban điều hành chợ",
  p3When: "Hôm qua · Thông báo",
  p3Pill: "Thông báo",
  p3Title: "Lịch nghỉ vận chuyển dịp lễ 2/9",
};

const en: LoginText = {
  loginTitle: "Sign in",
  loginLead: "Partner community — use the account your host issued.",
  loginSubmit: "Sign in",
  changeTitle: "Set a new password",
  changeLead: "First sign-in: replace the temporary password with your own.",
  changeSubmit: "Save password",
  totpTitle: "Two-factor authentication",
  totpLead: "Enter the 6-digit code from your authenticator app (or a backup code).",
  totpSubmit: "Confirm",
  tenant: "Company code",
  tenantHint: "provided by your host",
  username: "Username",
  usernamePh: "e.g. nguyenvanbay",
  password: "Password",
  newPassword: "New password",
  confirmPassword: "Re-enter new password",
  code: "Verification code",
  showPw: "Show password",
  hidePw: "Hide password",
  forgot: "Forgot your password? Contact your host to have it reset.",
  ssoPrefix: "Host staff? ",
  ssoLink: "Sign in with your AI System account",
  footer: "© Evolu Consulting · Partner community",
  showTitle: "Where partners meet demand",
  showDesc:
    "Post what you're selling or buying and exchange quotes with partners — all in one feed.",
  chip1: "Selling · Buying · Notices",
  chip2: "Quotes & partner matching",
  chip3: "Private to your host",
  stat1: "partners in the market",
  stat2Num: "2,400",
  stat2: "posts published",
  stat3: "new matches today",
  f1: "Post to sell / buy",
  f1d: "Draft in a minute, with price and quantity.",
  f2: "Private quotes",
  f2d: "Only the partners you pick see the price you send.",
  f3: "Supply–demand matching",
  f3d: "Suggests partners that fit your posts every day.",
  quote: "“Thanks to the shared feed, we closed an 8-tonne mango lot in a single afternoon.”",
  winTitle: "Feed — Partner market",
  p1When: "2h ago · Host only",
  p1Pill: "Selling",
  p1Title: "Hòa Lộc mango, grade 1",
  p1Ask: "Ask",
  p1Qty: "Qty",
  p1QtyV: "8 tonnes",
  p1Area: "Area",
  p2When: "5h ago · Friends",
  p2Pill: "Buying",
  p2Title: "Buying frozen passion fruit",
  p2Budget: "Budget",
  p2Need: "Need",
  p2NeedV: "15 t/mo",
  p2To: "Deliver to",
  p3Name: "Market admins",
  p3When: "Yesterday · Notice",
  p3Pill: "Notice",
  p3Title: "Shipping holiday schedule for Sep 2",
};

export const LOGIN_TEXT: Record<Lang, LoginText> = { vi, en };
