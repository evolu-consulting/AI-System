// HUB-FR-44 · đính kèm trong composer: chọn/kéo-thả → chặn sớm → hàng đợi; `ids` + `busy` cho nút Gửi.
import { type DragEvent, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import type { ApiError } from "~/lib/http";
import { type Chip, isBusy, markMissing, missingIds, readyIds } from "../lib/queue";
import { validateAttachment } from "../lib/validate.rules";
import { useAttachQueue } from "./use-attach-queue";

export type Attachments = ReturnType<typeof useAttachments>;

type Entry = Pick<Chip, "file" | "status" | "errorKey">;

/** Chặn sớm từng tệp theo luật; `overflow` = vượt số tệp tối đa (báo toast, không thêm chip). */
function triage(files: readonly File[], chips: readonly Chip[]) {
  const kept = chips.filter((c) => c.status !== "error").map((c) => c.file);
  const entries: Entry[] = [];
  let overflow = false;
  for (const file of files) {
    const r = validateAttachment(file, kept);
    if ("error" in r && r.error === "attach.err.max") overflow = true;
    else if ("error" in r) entries.push({ file, status: "error", errorKey: r.error });
    else {
      entries.push({ file, status: "queued" });
      kept.push(file);
    }
  }
  return { entries, overflow };
}

export function useAttachments() {
  const { t } = useTranslation();
  const q = useAttachQueue();
  const { chips, push, setChips } = q;

  const add = useCallback(
    (files: readonly File[]) => {
      const { entries, overflow } = triage(files, chips);
      push(entries);
      if (overflow) toast.error(t("attach.err.max"));
    },
    [chips, push, t],
  );

  /** Lỗi gửi `ATTACHMENT_NOT_FOUND`: chip có id trong `details.ids` → lỗi. Mã khác: bỏ qua. */
  const onSendError = useCallback(
    (err: ApiError) => {
      if (err.code === "ATTACHMENT_NOT_FOUND") setChips((cs) => markMissing(cs, missingIds(err)));
    },
    [setChips],
  );

  const dropProps = useMemo(
    () => ({
      onDragOver: (e: DragEvent) => e.preventDefault(),
      onDrop: (e: DragEvent) => {
        e.preventDefault();
        add(Array.from(e.dataTransfer.files));
      },
    }),
    [add],
  );

  return {
    chips,
    add,
    remove: q.remove,
    retry: q.retry,
    clear: q.clear,
    onSendError,
    dropProps,
    ids: readyIds(chips),
    busy: isBusy(chips),
  };
}
