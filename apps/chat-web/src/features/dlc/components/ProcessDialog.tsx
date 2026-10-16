// DLC-R12 · nút "Xem Process" + modal: các node của run AI SDLC hiện tại theo thứ tự (Understand → … → Result), trạng thái,
// agent (role) của node, số lần gọi agent, chi phí, token vào/ra. Làm mới 2 s khi run đang chạy (`useDlcProcess`).
import type { DlcNode, DlcProcessResponse } from "@ai/contracts/chat";
import { ArrowDown, ArrowRight, Workflow } from "lucide-react";
import { Fragment, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { cn } from "~/lib/utils";
import { useDlcProcess } from "../hooks/use-dlc";
import { formatTokens, formatUsd, NODE_TONE, totalsOf } from "../lib/process-view";

function NodeCard({ node, index }: { node: DlcNode; index: number }) {
  const { t } = useTranslation();
  const tone = NODE_TONE[node.state];
  return (
    <div
      className="relative flex h-full min-h-[132px] flex-col gap-1.5 rounded-xl border border-border bg-card p-3.5 shadow-sm"
      data-node={node.id}
    >
      <div className="flex items-start gap-2">
        <span className="text-xs font-semibold text-muted-foreground">{index + 1}</span>
        <h4 className="min-w-0 flex-1 text-sm leading-tight font-semibold">{node.title}</h4>
        <span className={cn("mt-1 size-2.5 shrink-0 rounded-full", tone.dot)} aria-hidden />
      </div>
      <span
        className={cn(
          "inline-flex w-fit items-center rounded-full px-2 py-0.5 text-xs font-medium",
          tone.badge,
        )}
      >
        {t(`dlc.state.${node.state}`)}
      </span>
      {node.roles.length > 0 && (
        <p className="truncate text-xs text-muted-foreground" title={node.roles.join(" · ")}>
          {node.roles.join(" · ")}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {t("dlc.calls", { count: node.llm_calls })} · {formatUsd(node.usd)}
        {node.units !== null &&
          ` · ${t("dlc.units", { merged: node.merged ?? 0, units: node.units })}`}
      </p>
      {node.tokens_in + node.tokens_out > 0 && (
        <p className="text-xs text-muted-foreground">
          {t("dlc.tokens", {
            in: formatTokens(node.tokens_in),
            out: formatTokens(node.tokens_out),
          })}
        </p>
      )}
    </div>
  );
}

function Body({ data }: { data: DlcProcessResponse }) {
  const { t } = useTranslation();
  if (data.engine === "unreachable") return <p className="text-sm">{t("dlc.engineDown")}</p>;
  if (data.engine === "not_configured") return <p className="text-sm">{t("dlc.engineOff")}</p>;
  if (!data.run || data.nodes.length === 0) return <p className="text-sm">{t("dlc.noRun")}</p>;
  const tot = totalsOf(data.nodes);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground">
        {t("dlc.run", { run: data.run, state: data.run_state ?? "?" })} ·{" "}
        {t("dlc.total", {
          calls: tot.calls,
          usd: formatUsd(tot.usd),
          tokens: formatTokens(tot.tokens),
        })}
      </p>
      <NodeFlow nodes={data.nodes} />
    </div>
  );
}

const PER_ROW = 4;

/** Nối cuối hàng trên (phải) → đầu hàng dưới (trái): đi xuống, sang trái, xuống tiếp vào bước kế. */
function RowConnector() {
  return (
    <div aria-hidden className="relative h-8 text-primary/60">
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
        viewBox="0 0 100 32"
        preserveAspectRatio="none"
      >
        <polyline
          points="88,0 88,14 12,14 12,32"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <ArrowDown className="absolute bottom-[-6px] left-[12%] size-4 -translate-x-1/2" />
    </div>
  );
}

/** Các bước theo chiều chạy: trái → phải trong hàng, xuống hàng nối bằng đường gấp khúc (≥ sm); di động: dọc ↓. */
function NodeFlow({ nodes }: { nodes: readonly DlcNode[] }) {
  const rows: DlcNode[][] = [];
  for (let i = 0; i < nodes.length; i += PER_ROW) rows.push(nodes.slice(i, i + PER_ROW));
  return (
    <>
      <ol className="flex flex-col items-stretch sm:hidden">
        {nodes.map((n, i) => (
          <li key={n.id}>
            {i > 0 && <ArrowDown aria-hidden className="mx-auto my-1 size-4 text-primary/60" />}
            <NodeCard node={n} index={i} />
          </li>
        ))}
      </ol>
      <ol className="hidden flex-col sm:flex">
        {rows.map((row, r) => (
          <li key={row[0]?.id ?? r}>
            {r > 0 && <RowConnector />}
            <div className="flex items-stretch">
              {Array.from({ length: PER_ROW }, (_, c) => {
                const n = row[c];
                const i = r * PER_ROW + c;
                return (
                  <Fragment key={n?.id ?? `empty-${c}`}>
                    {c > 0 && (
                      <div className="flex w-7 shrink-0 items-center justify-center">
                        {n && <ArrowRight aria-hidden className="size-4 text-primary/60" />}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">{n && <NodeCard node={n} index={i} />}</div>
                  </Fragment>
                );
              })}
            </div>
          </li>
        ))}
      </ol>
    </>
  );
}

function ProcessContent({ convId }: { convId: string }) {
  const { t } = useTranslation();
  const q = useDlcProcess(convId, true);
  return (
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-5xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Workflow className="size-5" aria-hidden />
          {t("dlc.processTitle")}
        </DialogTitle>
        <DialogDescription>{t("dlc.processHint")}</DialogDescription>
      </DialogHeader>
      {q.data ? <Body data={q.data} /> : <p className="text-sm">{t("dlc.loading")}</p>}
    </DialogContent>
  );
}

export function ProcessButton({ convId }: { convId: string }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-[30px] gap-1.5 rounded-full px-3 text-caption"
        onClick={() => setOpen(true)}
        data-dlc-process
      >
        <Workflow className="size-3.5" aria-hidden />
        {t("dlc.viewProcess")}
        <ArrowRight className="size-3.5" aria-hidden />
      </Button>
      {open && <ProcessContent convId={convId} />}
    </Dialog>
  );
}
