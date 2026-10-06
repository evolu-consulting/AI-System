// HUB-FR-10/91/94 · lỗi gửi hiện trong composer + đếm ngược 429 (`Retry-After`): chữ giữ nguyên, Gửi khoá tới 0.
import { useState } from "react";
import { replaceTag } from "~/features/agents/lib/mention";
import { replaceCommandName } from "~/features/commands/lib/slash";
import type { ApiError } from "~/lib/http";
import { retrySecondsOf, type SendErrorView, sendErrorView } from "../lib/send-error";
import { useCountdown } from "./use-countdown";

/** `onSubmit` của Composer: `true`/`{ok:true}` = đã gửi (xoá chữ + nháp); `false` giữ chữ; `{ok:false,error}` giữ chữ, mã `CMD_*` hiện trong ô. */
export type SubmitResult = boolean | { ok: true } | { ok: false; error: ApiError };

export function useSendError(currentText: string) {
  const [sent, setSent] = useState<{ error: ApiError; text: string } | null>(null);
  const cooldown = useCountdown();
  const expired = sent?.error.code === "TOO_MANY_RUNS" && cooldown.left === 0;
  const view: SendErrorView | null =
    sent && !expired ? sendErrorView(sent.error, sent.text, cooldown.left) : null;
  return {
    view,
    /** 429 đang đếm ngược → khoá Gửi. */
    cooling: cooldown.left > 0,
    set(error: ApiError, text: string) {
      setSent({ error, text });
      if (error.code === "TOO_MANY_RUNS") cooldown.start(retrySecondsOf(error));
    },
    /** Gõ chữ không xoá thông báo 429 khi còn đếm ngược (Gửi vẫn khoá); hết đếm → tự ẩn. */
    clear: () =>
      setSent((cur) => (cur?.error.code === "TOO_MANY_RUNS" && cooldown.left > 0 ? cur : null)),
    /** Nút "Ý bạn là": văn bản mới sau khi thay lệnh/tag bằng gợi ý. */
    applySuggestion(name: string): string {
      const base = sent?.text ?? currentText;
      return view?.tag !== undefined
        ? replaceTag(base, view.tag, name)
        : replaceCommandName(base, name);
    },
  };
}
