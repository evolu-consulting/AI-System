// CR-161 · luật thuần của «kết nối hai công ty»: nhãn tình trạng, câu lỗi dễ hiểu, kiểm tra ô tìm. Khớp contract `company-connect.ts`.
import { CC_NOTE_MAX, CC_SEARCH_MIN, type ConnectStatus } from "@ai/contracts/pack-contracts";

export type ConnectTone = "ok" | "wait" | "error" | "none";
/** `none` ⇒ «Chưa kết nối», `pending_out` ⇒ «Đã gửi lời mời», `pending_in` ⇒ «Chờ bạn trả lời», `declined` ⇒ «Bị từ chối». */
export const statusTone = (s: ConnectStatus): ConnectTone =>
  s === "connected"
    ? "ok"
    : s === "pending_out" || s === "pending_in"
      ? "wait"
      : s === "declined"
        ? "error"
        : "none";

/** Ô tìm đủ ký tự (sau trim) mới gọi máy chủ. */
export const searchReady = (raw: string): boolean => raw.trim().length >= CC_SEARCH_MIN;
/** Lời nhắn: cắt khoảng trắng, quá trần thì cắt bớt; rỗng ⇒ không gửi. */
export const noteOf = (raw: string | null): string | undefined => {
  const n = (raw ?? "").trim().slice(0, CC_NOTE_MAX);
  return n || undefined;
};

export type ConnectErr =
  | "notListed"
  | "declined"
  | "notConnected"
  | "forbidden"
  | "invalid"
  | "gone"
  | "failed";
const ERR_OF: Record<string, ConnectErr> = {
  CONNECT_NOT_LISTED: "notListed",
  CONNECT_DECLINED: "declined",
  CONNECT_NOT_CONNECTED: "notConnected",
  PACK_FORBIDDEN: "forbidden",
  VALIDATION_ERROR: "invalid",
  NOT_FOUND: "gone",
};
/** Mã lỗi API ⇒ khoá câu báo `contracts.connect.err.<khoá>`. */
export const connectErrKey = (code: string): ConnectErr => ERR_OF[code] ?? "failed";
