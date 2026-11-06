// CR-122 · U2 · FLOW2-FR-26: kiểm nối — cạnh vàng "Bước sau cần X, bước trước không có" + "Gợi ý cầu nối" (AI) có XEM TRƯỚC:
// Nhận ⇒ chèn node Ghi giá trị giữa hai bước; Bỏ ⇒ không đổi gì. Hợp đồng `bridge-suggest` của N2: xem `palette-api.ts`.
import type { ProcessDefInput } from "@ai/contracts/hub-admin";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { StageDraft } from "../../lib/draft-types";
import type { EdgeProblem } from "../../lib/palette-node";
import { stageToDraft } from "../../lib/stage-convert";
import { insertStepAfter } from "../../lib/step-ops";
import { type BridgeRequest, type BridgeResult, bridgeSuggest } from "../../palette-api";

type Props = {
  problems: readonly EdgeProblem[];
  stages: readonly StageDraft[];
  readOnly: boolean;
  /** Bản nháp hiện tại ở dạng gửi Hub (cho AI đọc tên + kiểu trường). */
  toDef: () => ProcessDefInput;
  onStages: (stages: StageDraft[]) => void;
};

function BridgeResultView(p: {
  res: BridgeResult | "error" | null;
  vi: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { t } = useTranslation();
  const { res } = p;
  if (res === null) return null;
  if (res === "error" || !res.ok)
    return (
      <p className="m-0 text-caption text-muted-foreground">
        {res === "error"
          ? t("process.admin.flow.bridge.none")
          : p.vi
            ? res.reason_vi
            : res.reason_en}
      </p>
    );
  return (
    <div className="rounded-md border border-border bg-card p-2" data-testid="flow-bridge-preview">
      <p className="m-0 text-caption">{p.vi ? res.explain_vi : res.explain_en}</p>
      <div className="mt-2 flex gap-2">
        <Button type="button" size="sm" onClick={p.onAccept}>
          {t("process.admin.flow.bridge.accept")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={p.onDismiss}>
          {t("process.admin.flow.bridge.dismiss")}
        </Button>
      </div>
    </div>
  );
}
function Line({ p, ...r }: { p: EdgeProblem } & Props) {
  const { t, i18n } = useTranslation();
  const [res, setRes] = useState<BridgeResult | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const from = r.stages.find((s) => s.uid === p.from);
  const to = r.stages.find((s) => s.uid === p.to);
  const vi = i18n.language === "vi";
  const ask = async () => {
    if (!from || !to) return;
    setBusy(true);
    try {
      setRes(
        await bridgeSuggest({
          // `toInput` bỏ trống vài mặc định (vd `back_to_steps`) mà schema Hub tự điền khi đọc.
          def: r.toDef() as unknown as BridgeRequest["def"],
          from: from.key,
          to: to.key,
        }),
      );
    } catch {
      setRes("error");
    } finally {
      setBusy(false);
    }
  };
  const accept = () => {
    if (!res || res === "error" || !res.ok || !from) return;
    const out = insertStepAfter(r.stages as StageDraft[], from.step, stageToDraft(res.stage, 0));
    if ("stages" in out) r.onStages(out.stages);
    setRes(null);
  };
  const okRes = res !== null && res !== "error" && res.ok ? res : null;
  return (
    <li className="space-y-1" data-testid="flow-edge-issue">
      <div className="flex flex-wrap items-center gap-2">
        <AlertTriangle aria-hidden className="size-4 text-warning" />
        <span className="text-caption text-warning">
          {t(`process.admin.flow.bridge.${p.rule}`, {
            key: p.key,
            got: p.got ?? "",
            expected: p.expected ?? "",
          })}
        </span>
        {r.readOnly || okRes ? null : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => void ask()}
          >
            {t("process.admin.flow.bridge.suggest")}
          </Button>
        )}
      </div>
      <BridgeResultView res={res} vi={vi} onAccept={accept} onDismiss={() => setRes(null)} />
    </li>
  );
}

export function BridgeIssues({ problems, ...rest }: Props & { problems: readonly EdgeProblem[] }) {
  if (problems.length === 0) return null;
  return (
    <ul
      className="m-0 list-none space-y-2 rounded-md border border-warning bg-warning-bg p-3"
      data-testid="flow-bridge"
    >
      {problems.map((p) => (
        <Line key={`${p.from}-${p.to}-${p.key}`} p={p} problems={problems} {...rest} />
      ))}
    </ul>
  );
}
