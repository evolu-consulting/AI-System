// CR-132 · W2 · mã lỗi API tin nhắn ⇒ khoá i18n (câu nói cách khắc phục). Lỗi lạ ⇒ câu chung.
import { MSG_ERRORS } from "@ai/contracts/pack-contracts";
import { ApiError } from "@ai/web-kit/http";

const KEY: Record<keyof typeof MSG_ERRORS, string> = {
  MSG_NOT_FOUND: "contracts.messages.err.notFound",
  MSG_DM_SELF: "contracts.messages.err.dmSelf",
  MSG_EMPTY: "contracts.messages.err.empty",
  MSG_NOT_OWNER: "contracts.messages.err.notOwner",
  MSG_NOT_SENDER: "contracts.messages.err.notSender",
  MSG_USER_INVALID: "contracts.messages.err.userInvalid",
  MSG_GROUP_FULL: "contracts.messages.err.groupFull",
  MSG_FILE_INVALID: "contracts.messages.err.file",
  MSG_DIRECT_FIXED: "contracts.messages.err.directFixed",
  MSG_PEER_INACTIVE: "contracts.messages.err.peerInactive",
  MSG_FILE_TOO_LARGE: "contracts.messages.err.file",
  MSG_FILE_TYPE: "contracts.messages.err.file",
};

const isMsgCode = (c: string): c is keyof typeof MSG_ERRORS => c in MSG_ERRORS;

export function errorKey(err: unknown): string {
  if (err instanceof ApiError) {
    const code = err.code as string;
    if (isMsgCode(code)) return KEY[code];
    if (err.status === 429) return "contracts.messages.err.rate";
    if (err.status === 0 || err.status >= 500) return "contracts.messages.err.load";
  }
  return "contracts.messages.err.generic";
}

/** 404 `MSG_NOT_FOUND` khi mở hội thoại = bị bỏ khỏi nhóm / không còn. */
export const isGone = (err: unknown): boolean =>
  err instanceof ApiError && (err.code as string) === "MSG_NOT_FOUND";
