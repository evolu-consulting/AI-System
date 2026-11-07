// CR-122 · U2d: nội dung node trên canvas của FLOW (có trigger) — ngôn ngữ nghiệp vụ: tên bước, loại node (theo bảng node), MỘT dòng tóm tắt,
// lỗi nói rõ lỗi gì. Không "Giai đoạn n:", không tên tool/executor kỹ thuật. Node Kết thúc có hình riêng (viên thuốc) ở cột cuối.
import { CircleAlert, Flag } from "lucide-react";
import { useTranslation } from "react-i18next";
import { FREE_ERR } from "../../lib/free-nodes";
import { kindOf, summaryOf } from "../../lib/node-summary";
import { nodeLabel } from "../../lib/palette-node";
import { usePalette } from "../../palette-api";
import { OP_SYMBOL } from "../flow/FactWhenEditor";
import { useFlowCtx } from "../flow/flow-ctx";
import type { StageView } from "./stage-view";

const OPS = OP_SYMBOL as Record<string, string>;

export const isFinishView = (v: StageView): boolean => v.src.outcome !== undefined;
/** CR-123 · u14 · điểm cuối: bước Kết thúc, hoặc chờ sự kiện thường (không thuộc node module) — KHÔNG có cổng ra, không có cạnh đi tiếp. */
export const isTerminalView = (v: StageView): boolean =>
  isFinishView(v) || (v.src.executor === "wait_event" && v.module === undefined && !v.src.node);

function useLabels() {
  const flow = useFlowCtx();
  const facts = flow?.event?.facts ?? [];
  return {
    fact: (k: string) => facts.find((f) => f.key === k)?.label ?? k,
    op: (o: string) => OPS[o] ?? o,
    step: (n: number) => flow?.stepName?.(n) ?? `${n + 1}`,
  };
}

const TECH_KINDS: ReadonlySet<string> = new Set(["set", "agent", "tool"]);

function ErrorLine({ v, kind }: { v: StageView; kind: string }) {
  const { t } = useTranslation();
  if (!v.errorKey) return null;
  // lỗi "tool chưa bật" nói tên tính năng (loại node), không nói "tool"
  const off = v.errorKey.endsWith("stage.tool.err.ref");
  const msg = off
    ? t("process.admin.flow.toolOff", { name: kind })
    : t(v.errorKey, { defaultValue: t("process.admin.canvas.node.error") });
  // CR-123 · u11: tính năng chưa bật ⇒ nhãn ngắn trên node (không tràn mép), câu đầy đủ + cách sửa ở tooltip; lỗi khác dài ⇒ tối đa 2 dòng
  const shown = off ? t("process.admin.flow.toolOffShort", { name: kind }) : msg;
  return (
    <span
      className="flex items-start gap-1 text-caption text-destructive"
      title={msg}
      data-testid="node-error"
    >
      <CircleAlert aria-hidden className="size-3 shrink-0" />
      <span className="line-clamp-2">{shown}</span>
    </span>
  );
}

export function FlowNodeBody({ v }: { v: StageView }) {
  const { t, i18n } = useTranslation();
  const flow = useFlowCtx();
  const palette = usePalette(flow?.app ?? "", flow?.tenantId);
  const l = useLabels();
  const s = v.src;
  const name = v.name || t("process.admin.editor.stage.unnamed");
  if (isFinishView(v)) {
    const out = flow?.event?.outcomes.find((o) => o.key === s.outcome)?.label ?? s.outcome ?? "";
    return (
      <span className="flex h-full items-center gap-2 text-left">
        <Flag aria-hidden className="size-4 shrink-0 text-success" />
        <span className="min-w-0">
          <span className="block truncate text-caption font-semibold text-success">
            {t("process.admin.flow.node.finish")}
          </span>
          <span className="block truncate text-label font-medium" title={out}>
            {out}
          </span>
        </span>
      </span>
    );
  }
  const mod = s.node ? palette.data?.find((n) => n.key === s.node) : undefined;
  const kind = mod ? nodeLabel(mod, i18n.language) : t(`process.admin.flow.node.${kindOf(s)}`);
  const summary = summaryOf(s, l);
  // loại kỹ thuật ("Chuẩn bị dữ liệu", "Agent") không phải việc nghiệp vụ của giám đốc/sale ⇒ không hiện dưới tên bước
  const hideKind = !mod && TECH_KINDS.has(kindOf(s));
  return (
    <span className="block min-w-0 text-left">
      <span className="block truncate text-label font-medium" title={name}>
        {name}
      </span>
      {kind !== name && !hideKind ? (
        <span className="block truncate text-caption text-muted-foreground">{kind}</span>
      ) : null}
      {summary ? (
        <span className="block truncate text-caption text-muted-foreground" title={summary}>
          {summary}
        </span>
      ) : null}
      {s.free === true ? (
        <span
          className="block truncate text-caption font-medium text-primary"
          data-testid="free-hint"
        >
          {t("process.admin.canvas.free.hint")}
        </span>
      ) : null}
      {s.free === true ? (
        <span
          className="block truncate text-caption text-muted-foreground"
          data-testid="free-name-hint"
        >
          {t("process.admin.canvas.free.nameHint")}
        </span>
      ) : null}
      {v.errorKey === FREE_ERR ? null : <ErrorLine v={v} kind={mod ? kind : name} />}
    </span>
  );
}

/** Lớp riêng cho node Kết thúc (viên thuốc viền xanh) — còn lại dùng `stageButtonClass`. */
export const FINISH_CLASS = "rounded-full border-2 border-success px-4";
