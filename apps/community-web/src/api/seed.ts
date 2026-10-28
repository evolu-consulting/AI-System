// Dữ liệu demo cho adapter mock (tenant demo): chủ quản + 4 đối tác + 5 sản phẩm. Thời gian tính lùi từ lúc khởi động.
import type {
  CommunityViewer,
  PartnerOrg,
  PostAudience,
  PostStatus,
  PostType,
} from "@ai/contracts/community";

export const HOST_ORG = { id: "host", name: "Công ty demo" } as const;

export const CATS = ["Đóng gói", "Chữ ký số", "Hoá đơn điện tử"];

export const PARTNERS: PartnerOrg[] = [
  {
    id: "tanphat",
    name: "Cơ sở Tân Phát",
    labels: ["supplier"],
    cats: ["Đóng gói"],
    area: "TP.HCM",
  },
  { id: "ncca", name: "Hãng NCCA", labels: ["supplier"], cats: ["Chữ ký số"], area: "Hà Nội" },
  {
    id: "abc",
    name: "Công ty TNHH ABC",
    labels: ["buyer"],
    cats: ["Chữ ký số", "Đóng gói"],
    area: "TP.HCM",
  },
  {
    id: "hungthinh",
    name: "Hưng Thịnh Logistics",
    labels: ["supplier", "buyer"],
    cats: ["Chữ ký số", "Hoá đơn điện tử"],
    area: "Đà Nẵng",
  },
];

export type Persona = CommunityViewer & { id: string; label: string };
const host = (
  id: string,
  name: string,
  role: "host_admin" | "host_member",
  label: string,
): Persona => ({
  id,
  userId: id,
  name,
  role,
  orgId: HOST_ORG.id,
  orgName: HOST_ORG.name,
  labels: [],
  cats: [],
  label,
});
const partner = (id: string, name: string, orgId: string, label: string): Persona => {
  const o = PARTNERS.find((p) => p.id === orgId) as PartnerOrg;
  return {
    id,
    userId: id,
    name,
    role: "partner",
    orgId,
    orgName: o.name,
    labels: o.labels,
    cats: o.cats,
    label,
  };
};
export const PERSONAS: Persona[] = [
  host("an", "Nguyễn Văn An", "host_admin", "A · Admin chủ quản (Nguyễn Văn An)"),
  host("cuong", "Lê Quốc Cường", "host_member", "M · Thành viên chủ quản (Lê Quốc Cường)"),
  partner("tp", "Anh Phát", "tanphat", "S1 · Cơ sở Tân Phát (NCC)"),
  partner("ncca", "Chị Hoa", "ncca", "S2 · Hãng NCCA (NCC)"),
  partner("abc", "Trần B", "abc", "B1 · Công ty TNHH ABC (người mua)"),
  partner("ht", "Anh Hưng", "hungthinh", "X · Hưng Thịnh Logistics (cả hai)"),
];

export type RawPost = {
  id: string;
  type: PostType;
  authorOrgId: string;
  authorName: string;
  createdMinAgo: number;
  status: PostStatus;
  hidden: boolean;
  edited: boolean;
  title: string;
  body: string;
  fields: Record<string, string | null>;
  cats: string[];
  media: { kind: "image" | "video"; label: string }[];
  audience: PostAudience;
};
export type RawComment = {
  id: string;
  postId: string;
  threadOrgId: string;
  authorOrgId: string;
  authorName: string;
  text: string;
  minAgo: number;
  hidden: boolean;
};

const aud = (
  mode: PostAudience["mode"],
  cats: string[] = [],
  companies: string[] = [],
): PostAudience => ({ mode, cats, companies });

export const SEED_POSTS: RawPost[] = [
  {
    id: "p1",
    type: "sell",
    authorOrgId: "host",
    authorName: "Lê Quốc Cường",
    createdMinAgo: 60,
    status: "active",
    hidden: false,
    edited: false,
    title: "Chữ ký số DN – USB Token",
    body: "Cấp serial trong ngày, kèm token, hỗ trợ cài đặt và nhắc gia hạn trước 30 ngày.",
    fields: {
      product: "Chữ ký số DN – USB Token",
      qty: "Từ 1 chữ ký",
      price: "1.650.000đ / chữ ký / năm",
      area: "Toàn quốc",
    },
    cats: ["Chữ ký số"],
    media: [
      { kind: "image", label: "USB Token" },
      { kind: "image", label: "Chứng thư số mẫu" },
    ],
    audience: aud("all"),
  },
  {
    id: "p2",
    type: "buy",
    authorOrgId: "host",
    authorName: "Nguyễn Văn An",
    createdMinAgo: 150,
    status: "active",
    hidden: false,
    edited: true,
    title: "Thùng phi 200L",
    body: "Cần thêm 40 thùng phi sạch, giao trong tuần.",
    fields: {
      product: "Thùng phi 200L",
      qty: "40 thùng",
      area: "TP.HCM",
      neededBy: "2026-11-05",
      budget: "300.000đ / thùng",
    },
    cats: ["Đóng gói"],
    media: [],
    audience: aud("suppliers"),
  },
  {
    id: "p3",
    type: "note",
    authorOrgId: "host",
    authorName: "Nguyễn Văn An",
    createdMinAgo: 1500,
    status: "active",
    hidden: false,
    edited: false,
    title: "",
    body: "Công ty nghỉ lễ 02/09, đơn đặt trước 30/08 sẽ giao sau lễ.",
    fields: {},
    cats: [],
    media: [],
    audience: aud("all"),
  },
  {
    id: "p4",
    type: "sell",
    authorOrgId: "host",
    authorName: "Lê Quốc Cường",
    createdMinAgo: 300,
    status: "active",
    hidden: false,
    edited: false,
    title: "Chữ ký số HSM",
    body: "Gói HSM cho doanh nghiệp ký số hàng loạt.",
    fields: { product: "Chữ ký số HSM", qty: "Từ 1 gói", price: null, area: "Toàn quốc" },
    cats: ["Chữ ký số"],
    media: [],
    audience: aud("buyers"),
  },
  {
    id: "p5",
    type: "sell",
    authorOrgId: "tanphat",
    authorName: "Anh Phát",
    createdMinAgo: 180,
    status: "active",
    hidden: false,
    edited: false,
    title: "Băng keo 5cm và thùng phi 200L — hàng sẵn kho",
    body: "Băng keo trong 5cm, thùng phi 200L đã súc rửa sạch. Gọi 0903 123 456 hoặc xem fb.com/tanphat. Cung cấp cùng Hãng NCCA.",
    fields: {
      product: "Băng keo 5cm · Thùng phi 200L",
      qty: "2.000 cuộn · 60 thùng",
      price: "3.800đ / cuộn · 300.000đ / thùng",
      area: "TP.HCM",
    },
    cats: ["Đóng gói"],
    media: [
      { kind: "image", label: "Băng keo 5cm" },
      { kind: "image", label: "Thùng phi 200L" },
      { kind: "video", label: "Video kho · 0:38" },
    ],
    audience: aud("all"),
  },
  {
    id: "p6",
    type: "buy",
    authorOrgId: "abc",
    authorName: "Trần B",
    createdMinAgo: 25,
    status: "active",
    hidden: false,
    edited: false,
    title: "Chữ ký số DN – USB Token",
    body: "Chữ ký số của công ty hết hạn 14/05, cần gia hạn sớm và thêm 1 chữ ký cho kế toán. Báo giá giúp mình nhé.",
    fields: {
      product: "Chữ ký số DN – USB Token",
      qty: "2 chữ ký · gói 1 năm",
      area: "TP.HCM",
      neededBy: "2026-11-14",
      budget: "",
    },
    cats: ["Chữ ký số"],
    media: [],
    audience: aud("all"),
  },
  {
    id: "p7",
    type: "sell",
    authorOrgId: "hungthinh",
    authorName: "Anh Hưng",
    createdMinAgo: 2600,
    status: "active",
    hidden: false,
    edited: false,
    title: "Hoá đơn điện tử — gói 500 hoá đơn",
    body: "Gói 500 hoá đơn điện tử, kích hoạt trong ngày. MST 0312345678.",
    fields: {
      product: "Hoá đơn điện tử",
      qty: "500 hoá đơn / gói",
      price: "350.000đ / gói",
      area: "Đà Nẵng",
    },
    cats: ["Hoá đơn điện tử"],
    media: [],
    audience: aud("all"),
  },
  {
    id: "p8",
    type: "sell",
    authorOrgId: "tanphat",
    authorName: "Anh Phát",
    createdMinAgo: 9000,
    status: "archived",
    hidden: false,
    edited: false,
    title: "Băng keo đục 4.8cm",
    body: "Hàng tồn kho cũ, giá tốt.",
    fields: {
      product: "Băng keo đục 4.8cm",
      qty: "800 cuộn",
      price: "3.200đ / cuộn",
      area: "TP.HCM",
    },
    cats: ["Đóng gói"],
    media: [],
    audience: aud("all"),
  },
  {
    id: "p9",
    type: "sell",
    authorOrgId: "ncca",
    authorName: "Chị Hoa",
    createdMinAgo: 400,
    status: "active",
    hidden: true,
    edited: false,
    title: "USB Token giá sốc",
    body: "Gọi ngay 0988 765 432.",
    fields: { product: "USB Token", qty: "100 cái", price: "1.100.000đ", area: "Hà Nội" },
    cats: ["Chữ ký số"],
    media: [],
    audience: aud("all"),
  },
];

export const SEED_COMMENTS: RawComment[] = [
  {
    id: "c1",
    postId: "p1",
    threadOrgId: "hungthinh",
    authorOrgId: "hungthinh",
    authorName: "Anh Hưng",
    text: "Bên mình cần thêm chữ ký HSM, báo giá giúp nhé.",
    minAgo: 35,
    hidden: false,
  },
  {
    id: "c2",
    postId: "p1",
    threadOrgId: "hungthinh",
    authorOrgId: "host",
    authorName: "Lê Quốc Cường",
    text: "Bên mình gửi báo giá qua đây trong hôm nay. Liên hệ 0901 111 222.",
    minAgo: 20,
    hidden: false,
  },
  {
    id: "c3",
    postId: "p1",
    threadOrgId: "abc",
    authorOrgId: "abc",
    authorName: "Trần B",
    text: "Gói 1 năm còn ưu đãi không bạn?",
    minAgo: 15,
    hidden: false,
  },
  {
    id: "c4",
    postId: "p6",
    threadOrgId: "abc",
    authorOrgId: "host",
    authorName: "Lê Quốc Cường",
    text: "Bên mình có sẵn, em gửi báo giá ngay nhé.",
    minAgo: 20,
    hidden: false,
  },
  {
    id: "c5",
    postId: "p5",
    threadOrgId: "tanphat",
    authorOrgId: "host",
    authorName: "Nguyễn Văn An",
    text: "Cho mình xin giá thùng phi nếu lấy 60 thùng.",
    minAgo: 90,
    hidden: false,
  },
];
