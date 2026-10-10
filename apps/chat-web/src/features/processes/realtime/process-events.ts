// HUB-FR-112, HUB-FR-113 · P-a FD9: sự kiện quy trình của `/me/stream` → chỉ patch/invalidate cache TanStack Query (không polling).
// `process.updated` vá `status/stage_idx` rồi invalidate view (chỉ query đang dùng); `review_task.*` làm tươi view + "Chờ tôi kiểm";
// `process.notice` giao PF3 (`onProcessNotice`); `stream.reset` làm tươi mọi thứ quy trình (trừ cờ engine và chuỗi đã nạp).
import type {
  MeStreamProcessEvent,
  ProcessRunView,
  ProcessUpdatedEventData,
} from "@ai/contracts/chat";
import type { QueryClient } from "@tanstack/react-query";
import { onProcessNotice } from "../inbox/on-process-notice";
import { processKeys } from "../shared/keys";

/** Vá `status` (+ `current_stage_idx` ở view `full`) của view đã có trong cache; chưa có ⇒ giữ `undefined`. */
export function patchRunView(
  view: ProcessRunView | undefined,
  e: Pick<ProcessUpdatedEventData, "status" | "stage_idx">,
): ProcessRunView | undefined {
  if (!view) return view;
  if (view.access === "full") {
    return { ...view, status: e.status, current_stage_idx: e.stage_idx };
  }
  return { ...view, status: e.status };
}

function onUpdated(client: QueryClient, e: ProcessUpdatedEventData): void {
  const key = processKeys.run(e.process_run_id);
  client.setQueryData<ProcessRunView>(key, (v) => patchRunView(v, e));
  void client.invalidateQueries({ queryKey: key, refetchType: "active" });
  // Danh sách run (thẻ Hỏi AI, admin) và token của run cũng đổi.
  void client.invalidateQueries({ queryKey: ["process", "runs"], refetchType: "active" });
  void client.invalidateQueries({
    queryKey: processKeys.usage(e.process_run_id),
    refetchType: "active",
  });
}

/** Mọi query quy trình, bỏ cờ engine và chuỗi đã nạp (không có gì để tải lại). */
const isDataKey = (key: readonly unknown[]): boolean =>
  key[0] === "process" && key[1] !== "engine" && key[1] !== "locale";

export function resetProcessCache(client: QueryClient): void {
  void client.invalidateQueries({ predicate: (q) => isDataKey(q.queryKey) });
}

/** Tin `process` của phòng tới (`room.message`): làm tươi view của run (bỏ qua tin `block` — run vừa tạo, chưa ai giữ view). */
export function onProcessRoomMessage(
  client: QueryClient,
  m: { process_run_id?: string; process?: { kind: string } },
): void {
  if (!m.process_run_id || m.process?.kind === "block") return;
  void client.invalidateQueries({
    queryKey: processKeys.run(m.process_run_id),
    refetchType: "active",
  });
}

export function routeProcessEvent(client: QueryClient, e: MeStreamProcessEvent): void {
  switch (e.event) {
    case "process.updated":
      onUpdated(client, e.data);
      return;
    case "review_task.created":
      void client.invalidateQueries({ queryKey: processKeys.tasks });
      void client.invalidateQueries({
        queryKey: processKeys.run(e.data.process_run_id),
        refetchType: "active",
      });
      return;
    case "review_task.closed":
      // Không mang `process_run_id`: làm tươi mọi view đang mở.
      void client.invalidateQueries({ queryKey: processKeys.tasks });
      void client.invalidateQueries({ queryKey: ["process", "run"], refetchType: "active" });
      return;
    case "process.notice":
      onProcessNotice(client, e.data);
      return;
  }
}
