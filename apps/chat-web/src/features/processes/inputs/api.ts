// HUB-FR-124 · AC-H37 · nơi duy nhất gọi `GET /process-runs/sources` và tải tệp cho trường `file` của form `!key`.
import {
  type ProcessSourceChip,
  ProcessSourceChipListResponseSchema,
} from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { uploadAttachment } from "~/features/attachments/api";
import { api } from "~/lib/http";
import { processKeys } from "../shared/keys";

const CHIPS_STALE_MS = 60_000;

/** Chip nguồn (không config/url/path). `enabled` bật lười: khi mở form hoặc khi AskCard có lựa chọn khớp. */
export function useSourceChips(enabled: boolean) {
  return useQuery<ProcessSourceChip[]>({
    queryKey: processKeys.sourceChips,
    queryFn: async ({ signal }) =>
      ProcessSourceChipListResponseSchema.parse(
        await api<unknown>("/process-runs/sources", { signal }),
      ).items,
    enabled,
    staleTime: CHIPS_STALE_MS,
    retry: false,
  });
}

/** Tải một tệp (H2c) cho trường `file`; trả `attachment_id` + tên. */
export async function uploadInputFile(
  file: File,
  signal?: AbortSignal,
): Promise<{ id: string; name: string }> {
  const att = await uploadAttachment(file, signal);
  return { id: att.id, name: file.name };
}
