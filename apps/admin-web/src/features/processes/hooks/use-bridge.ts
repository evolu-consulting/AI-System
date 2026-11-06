// CR-122 · U2d · FLOW2-FR-26: gợi ý cầu nối NGAY TRÊN canvas — mỗi cạnh vàng (from>to) có trạng thái riêng:
// chưa hỏi · đang hỏi · có đề xuất (xem trước node mờ, Nhận/Bỏ) · không gợi ý được (lý do tại ô đó). Nhận ⇒ chèn node Ghi giá trị thật.
import type { ProcessDefInput, ProcessStageDef } from "@ai/contracts/hub-admin";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { StageDraft } from "../lib/draft-types";
import { stageToDraft } from "../lib/stage-convert";
import { insertStepAfter } from "../lib/step-ops";
import { type BridgeRequest, bridgeSuggest } from "../palette-api";

export type BridgeUi =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "fail"; text: string }
  | { kind: "ok"; text: string };
export type BridgeEdge = { from: string; to: string };
export type BridgeApi = {
  ui: (e: BridgeEdge) => BridgeUi;
  ask: (e: BridgeEdge) => void;
  accept: (e: BridgeEdge) => void;
  dismiss: (e: BridgeEdge) => void;
};

const keyOf = (e: BridgeEdge): string => `${e.from}>${e.to}`;

export function useBridge(args: {
  stages: readonly StageDraft[];
  toDef: () => ProcessDefInput;
  onStages: (stages: StageDraft[]) => void;
}): BridgeApi {
  const { i18n, t } = useTranslation();
  const vi = i18n.language === "vi";
  const [ui, setUi] = useState<Record<string, BridgeUi>>({});
  const stageOf = useRef(new Map<string, ProcessStageDef>());
  const set = (e: BridgeEdge, v: BridgeUi | null) =>
    setUi((m) => {
      const { [keyOf(e)]: _drop, ...rest } = m;
      return v ? { ...rest, [keyOf(e)]: v } : rest;
    });
  const ask = async (e: BridgeEdge) => {
    const from = args.stages.find((s) => s.uid === e.from);
    const to = args.stages.find((s) => s.uid === e.to);
    if (!from || !to) return;
    set(e, { kind: "loading" });
    try {
      const res = await bridgeSuggest({
        // `toInput` bỏ trống vài mặc định (vd `back_to_steps`) mà schema Hub tự điền khi đọc.
        def: args.toDef() as unknown as BridgeRequest["def"],
        from: from.key,
        to: to.key,
      });
      if (res.ok) {
        stageOf.current.set(keyOf(e), res.stage);
        set(e, { kind: "ok", text: vi ? res.explain_vi : res.explain_en });
      } else set(e, { kind: "fail", text: vi ? res.reason_vi : res.reason_en });
    } catch {
      set(e, { kind: "fail", text: t("process.admin.flow.bridge.none") });
    }
  };
  const accept = (e: BridgeEdge) => {
    const st = stageOf.current.get(keyOf(e));
    const from = args.stages.find((s) => s.uid === e.from);
    if (!st || !from) return;
    const out = insertStepAfter(args.stages as StageDraft[], from.step, stageToDraft(st, 0));
    if ("stages" in out) args.onStages(out.stages);
    stageOf.current.delete(keyOf(e));
    set(e, null);
  };
  return {
    ui: (e) => ui[keyOf(e)] ?? { kind: "idle" },
    ask: (e) => void ask(e),
    accept,
    dismiss: (e) => {
      stageOf.current.delete(keyOf(e));
      set(e, null);
    },
  };
}
