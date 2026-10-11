// CHAT-AC-51 · CHAT-AC-52 · nơi duy nhất PF1 gọi `GET /processes` và `POST /process-runs` (plan-contract §3).
import {
  type CreateProcessRunRequest,
  CreateProcessRunResponseSchema,
  type ProcessCatalogItem,
  type ProcessListResponse,
  ProcessListResponseSchema,
} from "@ai/contracts/chat";
import type { ProcessInputDef, ProcessInputValue } from "@ai/contracts/hub-admin";
import { useQuery } from "@tanstack/react-query";
import { api } from "~/lib/http";
import { processKeys } from "../shared/keys";

const CATALOG_STALE_MS = 60_000;

// P-b (C2/C19): contract chat chưa có `inputs` ở catalog/request (đề xuất backend-lead). Tạm mở rộng kiểu phía FE;
// khi contract thêm, hai kiểu này trùng với contract (giao nhau vô hại).
export type CatalogItem = ProcessCatalogItem & { inputs?: readonly ProcessInputDef[] };
export type StartRequest = CreateProcessRunRequest & { inputs?: ProcessInputValue[] };

export const fetchCatalog = async (signal?: AbortSignal): Promise<ProcessListResponse> =>
  ProcessListResponseSchema.parse(await api<unknown>("/processes", { signal }));

/** Quy trình người dùng được chạy (menu `!`). Nạp lười: `enabled` chỉ bật khi gõ `!` lần đầu; lỗi hiện ngay + "Thử lại". */
export function useProcessMenu(enabled: boolean) {
  return useQuery<ProcessListResponse>({
    queryKey: processKeys.catalog,
    queryFn: ({ signal }) => fetchCatalog(signal),
    enabled,
    staleTime: CATALOG_STALE_MS,
    retry: false,
  });
}

/** `POST /process-runs` (Hỏi AI, FD4). 201 ⇒ tóm tắt run; 404 `PROCESS_NOT_FOUND`, 429 `TOO_MANY_PROCESS_RUNS` ném `ApiError`. */
export async function startProcess(body: StartRequest) {
  return CreateProcessRunResponseSchema.parse(
    await api<unknown>("/process-runs", { method: "POST", body }),
  );
}
