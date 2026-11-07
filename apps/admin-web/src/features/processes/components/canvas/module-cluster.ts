// CR-123 · FLOW3-FR-14 · node của app luôn là MỘT ô trên sơ đồ: gộp các stage liền nhau cùng `stage.node` (Ký số = gửi + chờ) thành MỘT
// StageView mang `module` (đầu ra theo kết quả nghiệp vụ), đánh lại số cột cho ô chiếm đúng một cột. Hàm THUẦN (không React) để test nhanh.
// Chỉ vẽ: bản nháp, `ops` và uid giữ nguyên — `fromStep` đổi cột đã gộp ⇄ bước thật cho lớp bọc `ops` (use-module-canvas).
import type { Edge, MarkerType } from "@xyflow/react"; // chỉ kiểu: file này nằm cả ở chunk chính (use-module-canvas), không kéo xyflow vào
import { exitHandle } from "../../lib/canvas-connect";
import type { StageDraft } from "../../lib/draft-types";
import type { ModuleExit, ModuleInfo, StageView } from "./stage-view";

export type ClusterStage = { uid: string; node?: string | undefined };
export type Cluster = { node: string; uids: string[] };

/**
 * Cụm stage liền nhau cùng `node` (≥ 2 stage). `sizeOf(node)` = số stage khai báo của node: cụm dài hơn thì cắt từng khúc
 * (hai node Ký số liền nhau ⇒ hai ô). TODO(CR-123 u3a): đổi sang `moduleClusters` của @ai/contracts khi u3a gộp (cùng chữ ký).
 */
export function moduleClusters(
  stages: readonly ClusterStage[],
  sizeOf: (node: string) => number = () => Number.POSITIVE_INFINITY,
): Cluster[] {
  const out: Cluster[] = [];
  let run: ClusterStage[] = [];
  const flush = () => {
    const node = run[0]?.node;
    if (node) {
      const size = Math.max(1, sizeOf(node));
      for (let i = 0; i < run.length; i += size) {
        const part = run.slice(i, i + size);
        if (part.length > 1) out.push({ node, uids: part.map((s) => s.uid) });
      }
    }
    run = [];
  };
  for (const s of stages) {
    if (run.length > 0 && run[0]?.node !== s.node) flush();
    run.push(s);
  }
  flush();
  return out;
}

export type ExitDecl = { key: string; label: string; on?: readonly string[] | undefined };
export type NodeInfo = { size: number; exits: readonly ExitDecl[] | undefined };

export type Collapsed = {
  views: StageView[];
  /** uid mọi stage trong cụm → uid stage đầu (ô). */
  head: ReadonlyMap<string, string>;
  /** Cột đã gộp → bước thật (cột vượt số cột = bước mới cuối). */
  fromStep: (col: number) => number;
};

const DEFAULT_EXITS: readonly ExitDecl[] = [{ key: "done", label: "" }];

/** Đầu ra của ô: "đi tiếp" (không `on`) + mỗi đầu ra có `on` nối tới đích của `wait_event.branches` khớp (bước thật → uid ô đích). */
function exitsOf(
  decl: readonly ExitDecl[],
  members: readonly StageView[],
  firstUidAtStep: (step: number) => string | undefined,
): ModuleExit[] {
  const branches = members.find((m) => m.src.executor === "wait_event")?.src.wait.branches ?? [];
  return decl.map((x) => {
    const to = new Set<string>();
    if (x.on)
      for (const b of branches) {
        const uid = b.step === null || !x.on.includes(b.on) ? undefined : firstUidAtStep(b.step);
        if (uid !== undefined) to.add(uid);
      }
    return { key: x.key, label: x.label, main: x.on === undefined, on: [...(x.on ?? [])], to: [...to] };
  });
}

export function collapseModules(
  views: readonly StageView[],
  infoOf: (node: string) => NodeInfo | undefined,
): Collapsed {
  const clusters = moduleClusters(
    views.map((v) => ({ uid: v.uid, node: v.src.node })),
    (n) => infoOf(n)?.size ?? Number.POSITIVE_INFINITY,
  );
  if (clusters.length === 0) return { views: [...views], head: new Map(), fromStep: (c) => c };
  const head = new Map<string, string>();
  for (const c of clusters) for (const u of c.uids) head.set(u, c.uids[0] as string);
  const kept = views.filter((v) => head.get(v.uid) === undefined || head.get(v.uid) === v.uid);
  const keptSteps = [...new Set(kept.map((v) => v.step))].sort((a, b) => a - b);
  const total = views.reduce((m, v) => Math.max(m, v.step + 1), 0);
  const toStep = (s: number): number => {
    const at = keptSteps.indexOf(s);
    if (at >= 0) return at;
    if (s >= total) return keptSteps.length;
    return Math.max(0, keptSteps.filter((k) => k < s).length - 1); // cột đã bị gộp ⇒ cột của ô
  };
  const fromStep = (c: number): number => keptSteps[c] ?? total;
  const firstUidAtStep = (s: number) => kept.find((k) => k.step === s)?.uid;
  const byHead = new Map(clusters.map((c) => [c.uids[0] as string, c]));
  const remap = (v: StageView): StageView => ({
    ...v,
    step: toStep(v.step),
    backTo: v.backTo.map(toStep),
    branch: v.branch.map((b) => (b === null ? null : toStep(b))),
    ifs: v.ifs && {
      yes: v.ifs.yes === null ? null : toStep(v.ifs.yes),
      no: v.ifs.no === null ? null : toStep(v.ifs.no),
    },
  });
  const merged = (v: StageView, c: Cluster): StageView => {
    const members = c.uids.map((u) => views.find((x) => x.uid === u) as StageView);
    const decl = infoOf(c.node)?.exits ?? DEFAULT_EXITS;
    const module: ModuleInfo = {
      node: c.node,
      uids: c.uids,
      members: members.map((m) => m.src),
      exits: exitsOf(decl.length > 0 ? decl : DEFAULT_EXITS, members, firstUidAtStep).map((x) => ({
        ...x,
        to: x.to.map((u) => head.get(u) ?? u),
      })),
    };
    return {
      ...remap(v),
      module,
      hasError: members.some((m) => m.hasError),
      errorKey: members.find((m) => m.errorKey)?.errorKey ?? null,
    };
  };
  return {
    views: kept.map((v) => {
      const c = byHead.get(v.uid);
      return c ? merged(v, c) : remap(v);
    }),
    head,
    fromStep,
  };
}

/** Cạnh từ các đầu ra có tên của ô module (Từ chối, Hết hạn…) tới ô đích; đầu ra "đi tiếp" do bố cục vẽ như cạnh tiến thường. */
export function moduleEdges(views: readonly StageView[]): Edge[] {
  const color = "var(--color-warning)";
  return views.flatMap((v) =>
    (v.module?.exits ?? []).flatMap((x) =>
      x.main
        ? []
        : x.to.map(
            (to): Edge => ({
              id: `${v.uid}>${to}#${x.key}`,
              source: v.uid,
              target: to,
              sourceHandle: exitHandle(x.key, x.on),
              data: { exit: true },
              focusable: false,
              label: x.label,
              labelStyle: { fill: color, fontSize: 12 },
              labelBgStyle: { fill: "var(--color-card)" },
              markerEnd: { type: "arrowclosed" as MarkerType, color },
              style: { stroke: color, strokeDasharray: "5 4" },
            }),
          ),
    ),
  );
}

/** Bản nháp ĐẦY ĐỦ các stage mà canvas đang vẽ (ô module trả lại mọi stage của cụm) — đầu vào của `connectPatch`. */
export const connectStages = (views: readonly StageView[]): StageDraft[] =>
  views.flatMap((v) => (v.module ? v.module.members : [v.src]));
