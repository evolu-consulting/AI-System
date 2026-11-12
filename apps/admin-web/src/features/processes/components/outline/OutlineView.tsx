// CR-127 · U2 · UI-FLOW · FLOW-FR-12…14 · spec §8.1 · mock Editor.dc: màn soạn quy trình VẼ THEO KHỐI (một màn, không công tắc Sơ đồ/Danh sách, không kéo thả).
// Khi nào chạy → bước → Nếu (hai cột Đúng / Sai, nhập lại) → Hoàn tất cố định; "+" trên đường nối; sửa chi tiết ở panel bên phải (StagePanel).
// Vẽ bằng xyflow ở `OutlineCanvas` (nạp lười); file này giữ phần NGHIỆP VỤ: cây ⇄ bản nháp, thẻ từng bước, chèn / lên / xuống / xoá.
// Nguồn thật là `StageDraft[]`; mọi phép sửa cấu trúc đi qua `lib/outline-edit` (cây ⇄ bản nháp, giữ uid) rồi `d.setStages`.
import { lazy, Suspense, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import type { DraftState } from "../../hooks/use-draft";
import type { EditorRefs } from "../../hooks/use-editor-refs";
import { useStagesMax } from "../../hooks/use-stages-max";
import { approveWarnings } from "../../lib/approve-rules";
import type { StageDraft } from "../../lib/draft-types";
import { clusterIndexes, draftClusterOf } from "../../lib/module-cluster";
import { isUnsupported, type Outline, type OutlineNode } from "../../lib/outline";
import {
  draftFromOutline,
  insertNodes,
  type Loc,
  moveNode,
  nodeFromDraft,
  outlineOfDraft,
  removeNode,
  takenKeys,
} from "../../lib/outline-edit";
import { endOutcomesOf, withDefaultEnds } from "../../lib/outline-ends";
import { emptyStage } from "../../lib/stage-convert";
import { Boundary } from "../canvas/CanvasView";
import { StagePanel } from "../canvas/StagePanel";
import type { Workbench } from "../canvas/use-workbench";
import { useFlowCtx } from "../flow/flow-ctx";
import type { PickedNode } from "../flow/NodeMenuContent";
import type { StepRowProps } from "./OutlineRows";
import type { LItem } from "./outline-layout";
import { useCardText } from "./use-card-text";

const OutlineCanvas = lazy(
  () => import(/* webpackChunkName: "outline-canvas" */ "./OutlineCanvas"),
);

type Props = { d: DraftState; w: Workbench; readOnly: boolean; refs: EditorRefs };

export function OutlineView({ d, w, readOnly, refs }: Props) {
  const { t } = useTranslation();
  const flow = useFlowCtx();
  const max = useStagesMax();
  const stages = d.draft.stages;
  const result = useMemo(() => outlineOfDraft(stages), [stages]);
  const ends = useMemo(() => endOutcomesOf(flow?.event), [flow?.event]);
  const text = useCardText(refs);
  const [removing, setRemoving] = useState<string | null>(null);
  // Hoàn tất + đích Từ chối / Trả lại: hiện ảo (`withDefaultEnds`) và ghi vào bản nháp khi sửa cấu trúc + khi LƯU (`prepareEnds` ở trang).
  // KHÔNG ghi lúc mở: bản nháp có thể chưa nạp xong (ghi sớm sẽ đè bản nạp ⇒ mất các bước).
  if (isUnsupported(result))
    return (
      <div className="space-y-3" data-testid="outline-unsupported">
        <Alert role="alert">
          {/* Lý do kỹ thuật (`result.reason`) chỉ cho log/test — người dùng thấy câu nghiệp vụ (Luật GỐC 3). */}
          <AlertDescription data-reason-code={result.code}>
            {t("process.admin.flow.outline.unsupported")}
          </AlertDescription>
        </Alert>
      </div>
    );
  const outline = withDefaultEnds(result, ends);
  const byKey = new Map(stages.map((s, i) => [s.key, { s, i }] as const));
  const warns = new Set(approveWarnings(stages).map((x) => x.uid));
  const room = max - stages.length;
  const commit = (o: Outline, pick?: string) => {
    const next = draftFromOutline(stages, withDefaultEnds(o, ends));
    const target = next.find((s) => s.key === pick);
    d.setStages(next, false, target?.uid);
  };
  const insert = (loc: Loc, index: number, items: PickedNode[]) => {
    const taken = takenKeys(outline);
    const nodes: OutlineNode[] = [];
    for (const it of items) {
      const n = nodeFromDraft({ ...emptyStage(), ...it.patch, name: it.name }, taken);
      taken.push(n.stage.key);
      nodes.push(n);
    }
    commit(insertNodes(outline, loc, index, nodes), nodes[0]?.stage.key);
  };
  const cards = new Map<string, StepRowProps>();
  const card = (n: OutlineNode, list: OutlineNode[], i: number): void => {
    const hit = byKey.get(n.stage.key);
    if (!hit) return;
    const { s, i: at } = hit;
    // Ký số (gửi + chờ ký) = MỘT khối: stage sau của cụm ẩn đi (chi tiết kỹ thuật)
    const cl = draftClusterOf(stages, at);
    const tx = text(
      s,
      cl ? clusterIndexes(stages, at).map((j) => stages[j] as StageDraft) : undefined,
    );
    cards.set(s.key, {
      uid: s.uid,
      title: tx.title,
      kind: tx.kind,
      kindId: tx.kindId,
      summary: tx.summary,
      errors: Object.keys(d.errors).filter((k) => k.startsWith(`stages.${at}.`)).length,
      warn: warns.has(s.uid),
      selected: w.open && w.sel?.uid === s.uid,
      readOnly,
      canUp: !cl && i > 0 && list[i - 1]?.kind !== "end",
      canDown: !cl && i < list.length - 1 && list[i + 1]?.kind !== "end",
      onSelect: () => w.select(s.uid, false),
      onMove: (dir) => commit(moveNode(outline, n.stage.key, dir), n.stage.key),
      onRemove: () => setRemoving(s.uid),
    });
  };
  /** Cây ⇒ đầu vào bố cục; thẻ từng bước gom vào `cards`. Cụm Ký số chỉ còn stage đầu (chỉ số "+" sau cụm = `i + span`). */
  const toItems = (items: OutlineNode[]): LItem[] =>
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: CR-127 · UI-FLOW — dựng nhiều khối, tách ở đợt dọn sau
    items.flatMap<LItem>((n, i) => {
      if (n.kind === "end") return [{ id: n.stage.key, kind: "end" as const, after: i + 1 }];
      const at = byKey.get(n.stage.key)?.i ?? -1;
      const cl = at < 0 ? null : draftClusterOf(stages, at);
      if (cl && at !== cl.start) return [];
      card(n, items, i);
      const after = i + (cl ? cl.end - cl.start : 1);
      return n.kind === "if"
        ? [{ id: n.stage.key, kind: "if" as const, after, yes: toItems(n.yes), no: toItems(n.no) }]
        : [{ id: n.stage.key, kind: "step" as const, after }];
    });
  const items = toItems(outline.items);
  const selectedKey = w.open ? stages.find((s) => s.uid === w.sel?.uid)?.key : undefined;
  const removeUid = removing ? stages.find((s) => s.uid === removing) : undefined;
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start" data-testid="outline-editor">
      <div className="min-w-0 flex-1">
        <Boundary
          fallback={() => (
            <p role="alert" className="text-body text-destructive">
              {t("process.admin.canvas.loadFailed")}
            </p>
          )}
        >
          <Suspense
            fallback={
              <p role="status" className="text-body text-muted-foreground">
                {(t as (k: string) => string)("process.admin.flow.outline.loading")}
              </p>
            }
          >
            <OutlineCanvas
              items={items}
              cards={cards}
              start={!!flow?.trigger}
              readOnly={readOnly}
              room={room}
              selectedKey={selectedKey}
              onInsert={insert}
            />
          </Suspense>
        </Boundary>
      </div>
      <StagePanel d={d} w={w} readOnly={readOnly} refs={refs} />
      <ConfirmDialog
        open={removeUid !== undefined}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={t("process.admin.canvas.confirmRemove.title", { name: removeUid?.name ?? "" })}
        description={t("process.admin.canvas.confirmRemove.body")}
        confirmLabel={t("process.admin.editor.remove")}
        destructive
        onConfirm={() => {
          if (removeUid) {
            const at = stages.findIndex((x) => x.uid === removeUid.uid);
            let o = outline;
            for (const j of clusterIndexes(stages, at))
              o = removeNode(o, (stages[j] as StageDraft).key, ends);
            commit(o);
          }
          setRemoving(null);
        }}
      />
    </div>
  );
}
