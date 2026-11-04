// CR-118 · cr118-flow-web · hook đọc/ghi flow qua `FlowRuntime`: `useFlowView` (một thực thể), `useFlowSummary` (huy hiệu danh sách,
// MỘT yêu cầu cho cả lô ≤ 100 ref), `useFlowSubmitForm`. `enabled=false` ⇒ không gọi mạng (nguồn do khe cấp, vd thẻ duyệt hiện có).
import type { FlowSummaryItem, FlowView } from "@ai/contracts/flow";
import { ApiError } from "@ai/web-kit/http";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { flowRuntime } from "../adapters/http";
import type { FlowRuntime } from "../port";
import { FlowFormError } from "../ui/types";

/** Trần ref mỗi lô = `FLOW_REF_MAX_BATCH` của contract (chép số, không import giá trị để schema zod không vào chunk đầu; test khớp). */
export const SUMMARY_BATCH = 100;
export const flowViewKey = (slot: string, ref: string) => ["flow", "view", slot, ref] as const;

export function useFlowView(o: {
  slot: string;
  refId: string;
  runtime?: FlowRuntime | undefined;
  enabled?: boolean | undefined;
}) {
  const rt = o.runtime ?? flowRuntime;
  return useQuery<FlowView | null>({
    queryKey: flowViewKey(o.slot, o.refId),
    queryFn: ({ signal }) => rt.view(o.slot, o.refId, signal),
    enabled: o.enabled !== false,
    retry: false,
    staleTime: 15_000,
  });
}

const chunks = <T>(xs: readonly T[], n: number): T[][] =>
  Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, (i + 1) * n));

/** Ref ⇒ tóm tắt. Runtime chưa bật / ref không thấy ⇒ vắng khỏi map (UI không hiện huy hiệu). Lô > 100 chia theo trần. */
export function useFlowSummary(o: {
  slot: string;
  refs: readonly string[];
  runtime?: FlowRuntime | undefined;
}) {
  const rt = o.runtime ?? flowRuntime;
  const key = [...o.refs].sort().join(",");
  return useQuery<ReadonlyMap<string, FlowSummaryItem>>({
    queryKey: ["flow", "summary", o.slot, key],
    queryFn: async ({ signal }) => {
      const out = new Map<string, FlowSummaryItem>();
      for (const part of chunks(o.refs, SUMMARY_BATCH)) {
        const s = await rt.summary(o.slot, part, signal);
        for (const it of s?.items ?? []) out.set(it.ref, it);
      }
      return out;
    },
    enabled: o.refs.length > 0,
    retry: false,
    staleTime: 30_000,
  });
}

/** Gửi form của task; Hub báo giá trị sai (`FORM_VALUES_INVALID`) ⇒ ném `FlowFormError(paths)`; xong ⇒ tải lại view + báo `onDone`. */
export function useFlowSubmitForm(o: {
  slot: string;
  refId: string;
  runtime?: FlowRuntime | undefined;
  onDone?: (() => void) | undefined;
}) {
  const rt = o.runtime ?? flowRuntime;
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (a: { taskId: string; values: Parameters<FlowRuntime["submitForm"]>[1] }) => {
      try {
        await rt.submitForm(a.taskId, a.values);
      } catch (e) {
        if (e instanceof ApiError && (e.code as string) === "FORM_VALUES_INVALID") {
          const p = (e.details as { paths?: unknown } | null | undefined)?.paths;
          throw new FlowFormError(Array.isArray(p) ? p.filter((x) => typeof x === "string") : []);
        }
        throw e;
      }
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: flowViewKey(o.slot, o.refId) });
      o.onDone?.();
    },
  });
}
