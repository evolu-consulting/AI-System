// CR-122 · U2 · FLOW2-FR-26: kiểm nối — cạnh vàng "Bước sau cần X, bước trước không có" + "Gợi ý cầu nối" (AI) có XEM TRƯỚC:
// Nhận ⇒ chèn node Ghi giá trị giữa hai bước; Bỏ ⇒ không đổi gì.
import type { AppNodeDecl } from "@ai/contracts/app-manifest";
import { AlertTriangle } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { emptyStage } from "../../lib/def-form";
import type { StageDraft } from "../../lib/draft-types";
import { type BridgeSuggestion, bridgePatch, type EdgeProblem } from "../../lib/palette-node";
import { insertStepAfter } from "../../lib/step-ops";
import { bridgeSuggest } from "../../palette-api";

type Props = {
  app: string;
  problems: readonly EdgeProblem[];
  stages: readonly StageDraft[];
  nodes: readonly AppNodeDecl[];
  readOnly: boolean;
  onStages: (stages: StageDraft[]) => void;
};

function Line({ p, ...r }: { p: EdgeProblem } & Omit<Props, "problems" | "nodes">) {
  const { t } = useTranslation();
  const [sug, setSug] = useState<BridgeSuggestion | "none" | null>(null);
  const [busy, setBusy] = useState(false);
  const stage = (uid: string) => r.stages.find((s) => s.uid === uid);
  const to = stage(p.to);
  const from = stage(p.from);
  const ask = async () => {
    setBusy(true);
    try {
      const s = await bridgeSuggest({
        app: r.app,
        from_node: from?.node ?? null,
        to_node: to?.node ?? "",
        issues: [
          {
            key: p.key,
            rule: p.rule,
            ...(p.expected ? { expected: p.expected } : {}),
            ...(p.got ? { got: p.got } : {}),
          },
        ],
      });
      setSug(s ?? "none");
    } catch {
      setSug("none");
    } finally {
      setBusy(false);
    }
  };
  const accept = () => {
    if (!sug || sug === "none" || !from) return;
    const fresh = { ...emptyStage(), ...bridgePatch(sug, t("process.admin.flow.bridge.nodeName")) };
    const out = insertStepAfter(r.stages as StageDraft[], from.step, fresh);
    if ("stages" in out) r.onStages(out.stages);
    setSug(null);
  };
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
        {r.readOnly || sug ? null : (
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
      {sug === "none" ? (
        <p className="m-0 text-caption text-muted-foreground">
          {t("process.admin.flow.bridge.none")}
        </p>
      ) : sug ? (
        <div
          className="rounded-md border border-border bg-card p-2"
          data-testid="flow-bridge-preview"
        >
          <ul className="m-0 list-none space-y-0.5 p-0 text-caption">
            {sug.rows.map((x) => (
              <li key={x.key}>
                {x.key} ← {"input" in x.from ? x.from.input : String(x.from.const)}
              </li>
            ))}
          </ul>
          <div className="mt-2 flex gap-2">
            <Button type="button" size="sm" onClick={accept}>
              {t("process.admin.flow.bridge.accept")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setSug(null)}>
              {t("process.admin.flow.bridge.dismiss")}
            </Button>
          </div>
        </div>
      ) : null}
    </li>
  );
}

export function BridgeIssues({ problems, nodes: _nodes, ...rest }: Props) {
  if (problems.length === 0) return null;
  return (
    <ul
      className="m-0 list-none space-y-2 rounded-md border border-warning bg-warning-bg p-3"
      data-testid="flow-bridge"
    >
      {problems.map((p) => (
        <Line key={`${p.from}-${p.to}-${p.key}`} p={p} {...rest} />
      ))}
    </ul>
  );
}
