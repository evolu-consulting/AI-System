// CHAT-AC-51 · CHAT-AC-52 · nơi duy nhất PF1 gọi `GET /processes` và `POST /process-runs` (plan-contract §3).
import {
  type CreateProcessRunRequest,
  CreateProcessRunResponseSchema,
  type ProcessListResponse,
  ProcessListResponseSchema,
} from "@ai/contracts/chat";
import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/http";
import { processKeys } from "../shared/keys";

const CATALOG_STALE_MS = 60_000;

/** Quy trình người dùng được chạy (menu `!`). Nạp lười: `enabled` chỉ bật khi gõ `!` lần đầu; lỗi hiện ngay + "Thử lại". */
export function useProcessMenu(enabled: boolean) {
  return useQuery<ProcessListResponse>({
    queryKey: processKeys.catalog,
    queryFn: async ({ signal }) =>
      ProcessListResponseSchema.parse(await api<unknown>("/processes", { signal })),
    enabled,
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

/** `POST /process-runs` (Hỏi AI, FD4). 201 ⇒ tóm tắt run; 404 `PROCESS_NOT_FOUND`, 429 `TOO_MANY_PROCESS_RUNS` ném `ApiError`. */
export async function startProcess(body: CreateProcessRunRequest) {
  return CreateProcessRunResponseSchema.parse(
    await api<unknown>("/process-runs", { method: "POST", body }),
  );
}
