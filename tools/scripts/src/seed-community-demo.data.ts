// com-c12a · dữ liệu thuần của seed cộng đồng đối tác (tenant demo). Không DB. Nguồn: prototype Cộng đồng (nhãn + nhóm hàng).
import type { PKey } from "./seed-demo-v2.specs";

export type CommunityLabel = "supplier" | "buyer";
export type PartnerSeed = {
  /** Tên công ty đối tác (admin.external_orgs.name). */
  name: string;
  username: string;
  displayName: string;
  /** Nhãn cộng đồng: `both` ⇒ cả hai. */
  labels: readonly CommunityLabel[];
  categories: readonly string[];
  /** Khoá đối tác trong Sổ Hợp Tác demo (seed-demo-v2.specs) khi đã có; null = chưa có trong SHT. */
  sht: PKey | null;
};

export const PARTNER_SEEDS: readonly PartnerSeed[] = [
  {
    name: "Cơ sở Tân Phát",
    username: "doitac-tanphat",
    displayName: "Tân Phát (đối tác)",
    labels: ["supplier"],
    categories: ["Thùng phi", "Thùng carton"],
    sht: "tanphat",
  },
  {
    name: "Hãng NCCA",
    username: "doitac-ncca",
    displayName: "Hãng NCCA (đối tác)",
    labels: ["supplier"],
    categories: ["Chữ ký số", "Hoá đơn điện tử"],
    sht: "ncca",
  },
  {
    name: "Bao bì Phương Nam",
    username: "doitac-phuongnam",
    displayName: "Bao bì Phương Nam (đối tác)",
    labels: ["supplier"],
    categories: ["Băng keo", "Thùng carton"],
    sht: null,
  },
  {
    name: "Công ty TNHH ABC",
    username: "doitac-abc",
    displayName: "ABC (đối tác)",
    labels: ["buyer"],
    categories: ["Băng keo", "Thùng phi", "Thùng carton"],
    sht: "abc",
  },
  {
    name: "Hưng Thịnh Logistics",
    username: "doitac-hungthinh",
    displayName: "Hưng Thịnh Logistics (đối tác)",
    labels: ["supplier", "buyer"],
    categories: ["Thùng carton", "Chữ ký số", "Hoá đơn điện tử"],
    sht: "hungthinh",
  },
];

/** Bài mẫu (prototype Cộng đồng). `by`: "host" (demo-owner) hoặc username đối tác. Định danh idempotent = (người đăng, tiêu đề). */
export type PostSeedType = "sell" | "buy" | "note";
export type ReplySeed = {
  /** "host" hoặc username đối tác. */
  by: string;
  /** Luồng (công ty) khi chủ quản trả lời: username đối tác của luồng. Đối tác: bỏ trống (luồng công ty mình). */
  thread?: string;
  text: string;
};
export type PostSample = {
  by: string;
  type: PostSeedType;
  title: string;
  body: string;
  fields: Record<string, string | null>;
  cats: readonly string[];
  /** Chỉ bài chủ quản. `cats` = nhóm hàng; mặc định theo loại (D2). */
  audience?: { mode: "all" | "suppliers" | "buyers" | "cats"; cats?: readonly string[] };
  replies?: readonly ReplySeed[];
};

/** Số điện thoại / email / link trong nội dung ĐỐI TÁC phải bị che khi người khác đọc (C4). */
export const POST_SAMPLES: readonly PostSample[] = [
  {
    by: "host",
    type: "buy",
    title: "Thùng phi 200L",
    body: "Cần mua thùng phi nhựa 200L nắp mở, giao TP.HCM, cần báo giá sớm.",
    fields: {
      product: "Thùng phi 200L",
      qty: "50 cái",
      area: "TP.HCM",
      neededBy: "2026-12-15",
      budget: "",
    },
    cats: ["Thùng phi"],
    audience: { mode: "cats", cats: ["Thùng phi"] },
    replies: [
      {
        by: "doitac-tanphat",
        text: "Bên em có sẵn, giá 480.000đ/cái, anh gọi 0903 123 456 giúp em nhé.",
      },
      {
        by: "host",
        thread: "doitac-tanphat",
        text: "Cho mình báo giá 100 cái, giao trong tuần sau.",
      },
      {
        by: "doitac-tanphat",
        text: "Em gửi báo giá chi tiết qua sales@tanphat.example hoặc Zalo 0903 123 456 ạ.",
      },
    ],
  },
  {
    by: "host",
    type: "sell",
    title: "Chữ ký số DN – USB Token",
    body: "Chữ ký số doanh nghiệp, USB Token, hỗ trợ cài đặt và kê khai thuế.",
    fields: { product: "Chữ ký số DN – USB Token", qty: "200 token", price: null, area: "" },
    cats: ["Chữ ký số"],
    audience: { mode: "cats", cats: ["Chữ ký số"] },
  },
  {
    by: "doitac-tanphat",
    type: "sell",
    title: "Băng keo 5cm",
    body: "Băng keo OPP 5cm x 100y, giá sỉ. Zalo: https://zalo.me/0903123456",
    fields: { product: "Băng keo 5cm", qty: "1000 cuộn", price: "9.500đ/cuộn", area: "TP.HCM" },
    cats: ["Băng keo"],
  },
  {
    by: "doitac-abc",
    type: "buy",
    title: "Chữ ký số DN – USB Token",
    body: "Cần mua chữ ký số cho 20 chi nhánh.",
    fields: {
      product: "Chữ ký số DN – USB Token",
      qty: "20 token",
      area: "Hà Nội",
      neededBy: "2026-12-01",
      budget: "",
    },
    cats: ["Chữ ký số"],
  },
  {
    by: "doitac-hungthinh",
    type: "buy",
    title: "Băng keo 5cm",
    body: "Cần mua băng keo cho kho vận chuyển.",
    fields: {
      product: "Băng keo 5cm",
      qty: "3000 cuộn",
      area: "Bình Dương",
      neededBy: "2026-12-10",
      budget: "",
    },
    cats: ["Băng keo"],
  },
  {
    by: "host",
    type: "note",
    title: "Lịch nghỉ lễ 20/11",
    body: "Văn phòng nghỉ ngày 20/11, làm việc lại từ 21/11. Đơn gấp xin liên hệ trước 18/11.",
    fields: {},
    cats: [],
    audience: { mode: "all" },
  },
];
