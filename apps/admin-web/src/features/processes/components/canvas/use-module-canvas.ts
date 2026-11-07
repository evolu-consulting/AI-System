// CR-123 · FLOW3-FR-14 · lớp bọc của CanvasView: gộp cụm stage của node module thành MỘT ô trước khi vào `ProcessCanvas`
// (views đã gộp + `ops` đổi cột đã gộp ⇄ bước thật + uid chọn/cảnh báo đổi sang stage đầu). Không có cụm / không phải flow ⇒ giữ nguyên.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { usePalette } from "../../palette-api";
import { type FlowCtx, useFlowCtx } from "../flow/flow-ctx";
import { collapseModules, type NodeInfo } from "./module-cluster";
import type { ProcessCanvasProps } from "./ProcessCanvas";

type Out = { props: ProcessCanvasProps; flow: FlowCtx | null };

const infoFrom =
  (nodes: readonly AppNodeDecl[] | undefined, lang: string) =>
  (key: string): NodeInfo | undefined => {
    const n = nodes?.find((x) => x.key === key);
    if (!n) return undefined;
    const pick = (l: { vi: string; en: string }) => (lang.startsWith("en") ? l.en : l.vi);
    return {
      exits: n.exits?.map((x) => ({ key: x.key, label: pick(x.label), on: x.on })),
    };
  };

export function useModuleCanvas(p: ProcessCanvasProps): Out {
  const flow = useFlowCtx();
  const { i18n } = useTranslation();
  const palette = usePalette(flow?.app ?? "", flow?.tenantId);
  const nodes = palette.data;
  const lang = i18n.language;
  const col = useMemo(
    () => (flow ? collapseModules(p.views, infoFrom(nodes, lang)) : null),
    [flow, p.views, nodes, lang],
  );
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
      dropNodes: (items, at) => ops.dropNodes(items, { ...at, step: col.fromStep(at.step) }),
      addStep: (step) => ops.addStep(col.fromStep(step + 1) - 1),
    },
  };
  const warn = flow.warnEdges
    ?.map((w) => ({ ...w, from: col.head.get(w.from) ?? w.from, to: col.head.get(w.to) ?? w.to }))
    .filter((w) => w.from !== w.to);
  return { props, flow: { ...flow, ...(warn ? { warnEdges: warn } : {}) } };
}
