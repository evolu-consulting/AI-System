// CR-056 · P-a Bước 0: STUB PF1 — gửi `!key …` (`POST /process-runs`) cho Hỏi AI (FD4) và phòng. Bước 0: không chặn tin nào.
import type { SubmitResult } from "~/features/composer/hooks/use-send-error";

export type BangOrigin =
  | { kind: "room"; roomId: string }
  | { kind: "conversation"; conversationId: string }
  | { kind: "none" };

export type BangSubmit = {
  /** `null` = không phải `!key` ⇒ để đường gửi thường xử lý. */
  intercept(text: string): Promise<SubmitResult> | null;
};

const PASS: BangSubmit = { intercept: () => null };

/** Hỏi AI: `origin` conversation / none. Cờ off ⇒ nên truyền `enabled=false`. */
export function useBangSubmit(_origin: BangOrigin, _enabled: boolean): BangSubmit {
  return PASS;
}
