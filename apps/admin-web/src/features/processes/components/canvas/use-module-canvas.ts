// CR-123 · FLOW3-FR-14 · lớp bọc của CanvasView: gộp cụm stage của node module thành MỘT ô trước khi vào `ProcessCanvas`
// (views đã gộp + `ops` đổi cột đã gộp ⇄ bước thật + uid chọn/cảnh báo đổi sang stage đầu). Không có cụm / không phải flow ⇒ giữ nguyên.
import { featureNodeByKey, MODULES } from "@ai/contracts/modules";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { type FlowCtx, useFlowCtx } from "../flow/flow-ctx";
import { collapseModules, type NodeInfo } from "./module-cluster";
import type { ProcessCanvasProps } from "./ProcessCanvas";

type Out = { props: ProcessCanvasProps; flow: FlowCtx | null };

/** CR-125 · x9 · đầu ra của node đọc từ sổ MODULES (nguồn duy nhất, không phụ thuộc palette theo công ty): ô Ký số luôn có đủ Ký xong / Từ chối / Hết hạn. */
const infoFrom =
  (lang: string) =>
  (key: string): NodeInfo | undefined => {
    const n = featureNodeByKey(MODULES, key);
    if (!n) return undefined;
    const pick = (l: { vi: string; en: string }) => (lang.startsWith("en") ? l.en : l.vi);
    return {
      exits: n.exits?.map((x) => ({ key: x.key, label: pick(x.label), on: x.on })),
    };
  };

/** Gộp cụm node module thành MỘT dòng/ô (flow có ngữ cảnh node); không phải flow ⇒ null. Canvas và danh sách bước dùng chung. */
export function useCollapsed(views: ProcessCanvasProps["views"]) {
  const flow = useFlowCtx();
  const { i18n } = useTranslation();
  const lang = i18n.language;
  return useMemo(() => (flow ? collapseModules(views, infoFrom(lang)) : null), [flow, views, lang]);
}

export function useModuleCanvas(p: ProcessCanvasProps): Out {
  const flow = useFlowCtx();
  const col = useCollapsed(p.views);
  if (!flow || !col || col.head.size === 0) return { props: p, flow };
  const { ops } = p;
  const props: ProcessCanvasProps = {
    ...p,
    views: col.views,
    stageCount: p.stageCount ?? p.views.length,
    selected: p.selected === undefined ? undefined : (col.head.get(p.selected) ?? p.selected),
    ops: {
      ...ops,
      setStep: (i, step) => ops.setStep(i, col.fromStep(step)),
      add: (step) => ops.add(step === undefined ? undefined : col.fromStep(step)),
      addStep: (step) => ops.addStep(col.fromStep(step + 1) - 1),
    },
  };
  const warn = flow.warnEdges
    ?.map((w) => ({ ...w, from: col.head.get(w.from) ?? w.from, to: col.head.get(w.to) ?? w.to }))
    .filter((w) => w.from !== w.to);
  return { props, flow: { ...flow, ...(warn ? { warnEdges: warn } : {}) } };
}
