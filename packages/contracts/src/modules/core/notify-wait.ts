// CR-127 · E9 · R#39 · hai node GỘP của lõi: «Thông báo» (`core.notify`: chuông / email / cả hai) và «Chờ» (`core.wait`: tới ngày / một khoảng).
// Menu chỉ còn hai mục thay cho bốn (Thông báo chuông, Gửi email, Hẹn giờ, Chờ khoảng). Executor GIỮ NGUYÊN (`notify`, `wait_until`,
// `wait_for`) — engine không đổi; cấu hình gộp chỉ là hình nhìn của panel ⇒ các hàm dưới đây đổi qua lại executor ⇄ cấu hình, và ánh xạ
// khoá node cũ ⇒ mới. Khoá cũ vẫn có trong sổ (`stage.node` của def đã lưu / lượt đang chạy không vỡ). Thuần, không I/O.
import { z } from "zod";
import { WAIT_OFFSET_DAYS, WaitTimeSchema } from "../../chat/processes";
import { NOTIFY_BODY_MAX, NOTIFY_TITLE_MAX, NotifyToSchema } from "../../hub-admin/process-notify";
import { WAIT_FOR_HOURS, WaitFromSchema } from "../../hub-admin/process-wait";
import type { PortSchema } from "../types";

export const NOTIFY_NODE_KEY = "core.notify";
export const WAIT_NODE_KEY = "core.wait";

/** Khoá node cũ ⇒ node gộp mới (def đã lưu mang khoá cũ vẫn đọc được; panel mở bằng node mới). */
export const LEGACY_CORE_NODE_MAP: Readonly<Record<string, string>> = {
  "core.bell": NOTIFY_NODE_KEY,
  "core.email": NOTIFY_NODE_KEY,
  "core.wait-until": WAIT_NODE_KEY,
  "core.wait-for": WAIT_NODE_KEY,
};

/** Khoá node chuẩn: khoá cũ ⇒ khoá mới; khoá khác giữ nguyên. */
export const canonicalCoreNode = (key: string): string => LEGACY_CORE_NODE_MAP[key] ?? key;

export const NOTIFY_CHANNEL_CHOICES = ["bell", "email", "both"] as const;
export type NotifyChannelChoice = (typeof NOTIFY_CHANNEL_CHOICES)[number];

/** Cấu hình «Thông báo»: kênh · người nhận · nội dung (dòng đầu = tiêu đề, phần sau = nội dung chi tiết). */
// z.lazy: contracts có vòng nhập (chat/processes → … → sổ module); dựng schema lúc DÙNG, không lúc nạp file.
export const NotifyConfigSchema = z.lazy(() =>
  z.strictObject({
    channel: z.enum(NOTIFY_CHANNEL_CHOICES),
    to: NotifyToSchema.array().max(5),
    text: z.string().max(NOTIFY_TITLE_MAX + 1 + NOTIFY_BODY_MAX),
  }),
);
export type NotifyConfig = z.infer<typeof NotifyConfigSchema>;

/** Cấu hình «Chờ»: tới ngày (nguồn ngày + lệch ngày + giờ) HOẶC sau một khoảng giờ. */
export const WaitConfigSchema = z.lazy(() =>
  z.union([
    z.strictObject({
      until_date: WaitFromSchema,
      offset_days: z.number().int().min(WAIT_OFFSET_DAYS.min).max(WAIT_OFFSET_DAYS.max).default(0),
      time: WaitTimeSchema.optional(),
    }),
    z.strictObject({
      duration_h: z.number().int().min(WAIT_FOR_HOURS.min).max(WAIT_FOR_HOURS.max),
    }),
  ]),
);
export type WaitConfig = z.infer<typeof WaitConfigSchema>;

export const NOTIFY_CONFIG_PORT: PortSchema = {
  schema: NotifyConfigSchema,
  widgets: { channel: "enum", to: "people", text: "longtext" },
};
export const WAIT_CONFIG_PORT: PortSchema = {
  schema: WaitConfigSchema,
  widgets: { until_date: "date", offset_days: "days", time: "text", duration_h: "hours" },
};

type NotifyEx = {
  kind: "notify";
  to: z.infer<typeof NotifyToSchema>[];
  channels: ("bell" | "email")[];
  title: string;
  body: string;
};

/** executor `notify` ⇒ cấu hình gộp (cả chuông + email ⇒ `both`; chỉ email ⇒ `email`; còn lại `bell`). */
export function notifyConfigOf(ex: Pick<NotifyEx, "to" | "channels" | "title" | "body">) {
  const email = ex.channels.includes("email");
  const bell = ex.channels.includes("bell");
  const channel: NotifyChannelChoice = email ? (bell ? "both" : "email") : "bell";
  const text = ex.body === "" ? ex.title : `${ex.title}\n${ex.body}`;
  return { channel, to: ex.to, text } satisfies NotifyConfig;
}

/** Cấu hình gộp ⇒ executor `notify` (dòng đầu của `text` = tiêu đề). */
export function notifyExecutorOf(c: NotifyConfig): NotifyEx {
  const at = c.text.indexOf("\n");
  const title = (at < 0 ? c.text : c.text.slice(0, at)).slice(0, NOTIFY_TITLE_MAX);
  const body = at < 0 ? "" : c.text.slice(at + 1);
  const channels: NotifyEx["channels"] =
    c.channel === "both" ? ["bell", "email"] : c.channel === "email" ? ["email"] : ["bell"];
  return { kind: "notify", to: c.to, channels, title, body };
}

type WaitUntilEx = {
  kind: "wait_until";
  from: z.infer<typeof WaitFromSchema>;
  offset_days: number;
  time?: string | undefined;
};

/** executor `wait_until` / `wait_for` ⇒ cấu hình «Chờ». */
export function waitConfigOf(ex: WaitUntilEx | { kind: "wait_for"; hours: number }): WaitConfig {
  if (ex.kind === "wait_for") return { duration_h: ex.hours };
  return {
    until_date: ex.from,
    offset_days: ex.offset_days,
    ...(ex.time !== undefined ? { time: ex.time } : {}),
  };
}

/** Cấu hình «Chờ» ⇒ executor (`duration_h` ⇒ `wait_for`; `until_date` ⇒ `wait_until`). */
export function waitExecutorOf(
  c: WaitConfig,
):
  | { kind: "wait_for"; hours: number }
  | { kind: "wait_until"; from: WaitUntilEx["from"]; offset_days: number; time?: string } {
  if ("duration_h" in c) return { kind: "wait_for", hours: c.duration_h };
  return {
    kind: "wait_until",
    from: c.until_date,
    offset_days: c.offset_days,
    ...(c.time !== undefined ? { time: c.time } : {}),
  };
}
