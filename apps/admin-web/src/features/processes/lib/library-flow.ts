// CR-122 · xem flow Thư viện theo sự kiện (có `trigger`, không khe) ở chế độ chỉ đọc: cùng canvas với trình sửa.
// Def khe cũ (không `trigger`) ⇒ null ⇒ giữ bảng bước từ `slot_body`. Hàm thuần.
import type { FlowTrigger, ProcessDefInput } from "@ai/contracts/hub-admin";
import { type DefDraft, toDraft } from "./def-form";
import { hasTrigger } from "./flow-def";

export type LibraryFlow = { trigger: FlowTrigger; app: string; draft: DefDraft };

type ViewLike = {
  name: string;
  description?: string;
  stages: readonly unknown[];
  trigger?: unknown;
  app?: unknown;
};

export function libraryFlowOf(v: ViewLike): LibraryFlow | null {
  if (!hasTrigger(v) || typeof v.app !== "string" || !Array.isArray(v.stages)) return null;
  const def = {
    key: "",
    name: v.name,
    description: v.description ?? "",
    input_hint: "",
    run_group_ids: [],
    token_budget: null,
    enabled: true,
    stages: v.stages,
    sources: [],
    inputs: [],
  } as unknown as ProcessDefInput;
  return { trigger: v.trigger, app: v.app, draft: toDraft(def) };
}
