// CR-127 · U3 · M3 «Chạy thử» · cột giữa: đường đi từng bước; bước đang chờ nói "Lúc chạy thật sẽ giao cho…" + nút đóng vai.
import { Check } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DecisionResult, Row, Summary } from "../../lib/test-run";

type LooseT = (key: string, opts?: Record<string, unknown>) => string;
const useLooseT = () => useTranslation() as unknown as { t: LooseT };
const K = "process.admin.flow.testRun.";

type Props = {
  rows: Row[];
  summary: Summary | null;
  busy: boolean;
  onDecide: (r: Row, result: DecisionResult, actorId: string | null) => void;
};

function WaitingBody({ r, busy, onDecide }: { r: Row } & Pick<Props, "busy" | "onDecide">) {
  const { t } = useLooseT();
  const [actor, setActor] = useState<string>(r.holderOptions[0]?.value ?? "");
  const act = actor === "" ? null : actor;
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <p className="text-muted-foreground">
        {r.holders ? t(`${K}willAssign`, { who: r.holders }) : t(`${K}noOne`)}
        {r.holdersRule ? ` (${r.holdersRule})` : ""}
      </p>
      {r.needs ? (
        <p className="text-muted-foreground">{t(`${K}needs`, { what: r.needs })}</p>
      ) : null}
      {r.holderOptions.length > 1 ? (
        <label className="flex items-center gap-2 text-label">
          {t(`${K}actAs`)}
          <select
            className="rounded-md border border-border bg-background px-2 py-1"
            value={actor}
            onChange={(e) => setActor(e.target.value)}
          >
            {r.holderOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => onDecide(r, "approve", act)}
          data-testid="testrun-approve"
        >
          {t(`${K}approve`)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => onDecide(r, "return", act)}
          data-testid="testrun-return"
        >
          {t(`${K}return`)}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          className="text-destructive"
          onClick={() => onDecide(r, "reject", act)}
          data-testid="testrun-reject"
        >
          {t(`${K}reject`)}
        </Button>
      </div>
    </div>
  );
}

export function TestRunPath({ rows, summary, busy, onDecide }: Props) {
  const { t } = useLooseT();
  return (
    <ol className="flex flex-col gap-3" data-testid="testrun-path" aria-label={t(`${K}path`)}>
      {rows.map((r) => (
        <li
          key={r.key}
          data-state={r.state}
          className={cn(
            "flex items-start gap-3 text-body",
            r.state === "waiting" && "rounded-lg border border-warning bg-warning/10 p-3",
          )}
        >
          <span
            aria-hidden
            className={cn(
              "flex size-6 shrink-0 items-center justify-center rounded-full text-caption text-primary-foreground",
              r.state === "waiting" ? "bg-warning" : "bg-success",
            )}
          >
            {r.state === "waiting" ? r.n : <Check className="size-4" />}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <div>
              <b>{r.title}</b>
              {r.note ? <span className="text-muted-foreground"> · {r.note}</span> : null}
            </div>
            {r.blocked ? <p className="text-destructive">{r.blocked}</p> : null}
            {r.state === "waiting" ? <WaitingBody r={r} busy={busy} onDecide={onDecide} /> : null}
          </div>
        </li>
      ))}
      {summary ? (
        <li
          data-testid="testrun-summary"
          data-tone={summary.tone}
          className={cn(
            "text-body",
            summary.tone === "stop" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {summary.text}
        </li>
      ) : null}
    </ol>
  );
}
