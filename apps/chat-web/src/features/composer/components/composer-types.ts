// CHAT-AC-05, HUB-FR-10 · kiểu công khai của Composer (tách khỏi component để giữ ≤ 200 dòng).
// Kiểu `SubmitResult` ở hook (component không import `~/lib/http` — depcruise component-no-fetch).
import type { SubmitResult } from "../hooks/use-send-error";

export type { SubmitResult };

export type ComposerHandle = {
  /** Điền sẵn (thẻ gợi ý): thay nội dung, focus, con trỏ cuối, KHÔNG gửi. */
  fill(text: string): void;
  focus(): void;
};

export type ComposerProps = {
  variant: "main" | "flow" | "room";
  /** `draftKey(convId, flowId)`. */
  draftKey: string;
  /** Run khác đang chạy trong hội thoại: gõ được, Gửi disabled + tooltip `composer.busy` (UC-02). */
  locked?: boolean;
  /** Run của composer này đang chạy: nút Gửi thành Dừng, Esc dừng. */
  running?: boolean;
  /** `run.started.quota.state = over`. */
  quotaOver?: boolean;
  autoFocus?: boolean;
  /** Menu `/` và `@` (mặc định bật). Tắt: không gọi `GET /commands`/`/agents`, `@x`/`/x` gửi nguyên văn (phòng X2a). */
  menus?: boolean;
  /** Nút/hàng đính kèm + vùng thả tệp (mặc định bật). Tắt: kéo-thả không upload (X2a Q3/§5.3). */
  attachments?: boolean;
  /** `room`: nhãn textbox, cũng là placeholder (vd "Tin nhắn cho nhóm"). */
  inputLabel?: string;
  /** Quá giới hạn ký tự → Gửi disabled; hiện bộ đếm từ 90 %. */
  maxChars?: number;
  onSubmit(text: string, attachmentIds?: string[]): Promise<SubmitResult>;
  onStop?(): void;
};
