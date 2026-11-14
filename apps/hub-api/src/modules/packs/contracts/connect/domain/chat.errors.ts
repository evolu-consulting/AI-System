// CR-161 · lát 6 · lỗi nghiệp vụ của use case trò chuyện (lớp 1, không I/O). Route đổi sang AppError qua `ccError` (mã contract → HTTP theo `CC_ERRORS`).
import type { CcErrorCode } from "@ai/contracts/pack-contracts";

export class ChatFail extends Error {
  constructor(readonly code: CcErrorCode) {
    super(code);
    this.name = "ChatFail";
  }
}
