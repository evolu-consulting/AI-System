// HUB-FR-129 · P-c2 §1.3 · khối "Kết quả áp bản sửa": PR (liên kết https), nhánh, commit, rebase, tự gộp; Chỉ nhánh ⇒ tải .diff.
// Bản chép: chat-web `shared/apply/ApplyResult.tsx` (TECH-DEBT FC11). Thuần, không fetch (trừ tải .diff qua `load`).
import type { ApplyStageView } from "@ai/contracts/chat";
import { memo } from "react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { sha7 } from "../../../lib/apply-view";
import { shortBranch } from "../../../lib/autofix-view";
import { type LoadContent, useDownload } from "../autofix/use-autofix-content";
import { ApplyPrLink } from "./ApplyPrLink";

const K = "process.common.apply.";
type DiffFile = { id: string; name: string };
type Props = {
  view: ApplyStageView;
  /** Nhánh đích (`apply_base`) của stage tự sửa liền trước. */
  base?: string | null;
  /** `diff_file` của stage tự sửa liền trước (cho "Tải .diff" khi Chỉ nhánh cục bộ). */
  diffFile?: DiffFile | null;
  load: LoadContent;
};

const TONE = {
  pr_opened: "ok",
  pushed: "ok",
  branch_only: "info",
  no_changes: "off",
  conflict: "err",
  check_failed: "err",
  failed: "err",
} as const;

function Local({ diffFile, load }: { diffFile?: DiffFile | null; load: LoadContent }) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col gap-1.5 text-caption">
      <span className="text-muted-foreground">{t(`${K}localHint`)}</span>
      {diffFile && <DiffActions diffFile={diffFile} load={load} />}
    </div>
  );
}

function DiffActions({ diffFile, load }: { diffFile: DiffFile; load: LoadContent }) {
  const { t } = useTranslation();
  const download = useDownload(load);
  return (
    <>
      <code className="w-fit rounded bg-muted px-1.5 py-0.5 font-mono">{`git apply ${diffFile.name}`}</code>
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        onClick={() => void download(diffFile)}
      >
        {t(`${K}downloadDiff`)}
      </Button>
    </>
  );
}

function Details({ view, base }: { view: ApplyStageView; base?: string | null }) {
  const { t } = useTranslation();
  const head = sha7(view.head_sha);
  const target = sha7(view.target_sha);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-caption">
        {view.pr_number !== null && <ApplyPrLink view={view} />}
        {view.branch && (
          <span title={view.branch} className="font-mono text-muted-foreground">
            {t(`${K}branch`, { branch: shortBranch(view.branch) })}
            {base ? ` → ${base}` : ""}
          </span>
        )}
        {head && (
          <span className="font-mono text-muted-foreground">{t(`${K}commit`, { sha: head })}</span>
        )}
        {view.rebased && target && (
          <Badge variant="info">{t(`${K}rebased`, { sha: target })}</Badge>
        )}
        {view.auto_merge === "on" && <Badge variant="ok">{t(`${K}auto.on`)}</Badge>}
        {view.auto_merge === "failed" && <Badge variant="warn">{t(`${K}auto.failed`)}</Badge>}
      </div>
      {view.rebased && target && (
        <p className="text-caption text-muted-foreground">{t(`${K}rebasedHint`)}</p>
      )}
      {view.auto_merge === "failed" && (
        <p className="text-caption text-muted-foreground">{t(`${K}auto.failedHint`)}</p>
      )}
    </>
  );
}

function ApplyResultImpl({ view, base, diffFile, load }: Props) {
  const { t } = useTranslation();
  const label =
    view.status === "conflict"
      ? t(`${K}status.conflict`, { n: view.conflict_files.length })
      : t(`${K}status.${view.status}`);
  const hasRef = view.pr_number !== null || view.branch !== null || view.head_sha !== null;
  return (
    <section
      aria-label={t(`${K}region`)}
      className="flex flex-col gap-2 rounded-lg border border-border bg-background p-3"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold">{t(`${K}title`)}</span>
        <Badge variant={TONE[view.status]}>{label}</Badge>
      </div>
      {(view.status === "pr_opened" || view.status === "pushed") && hasRef && (
        <Details view={view} base={base} />
      )}
      {view.status === "pushed" && view.mode === "branch_only" && (
        <p className="text-caption text-muted-foreground">{t(`${K}pushedOnly`)}</p>
      )}
      {view.status === "branch_only" && <Local diffFile={diffFile} load={load} />}
      {view.status === "no_changes" && (
        <p className="text-caption text-muted-foreground">{t(`${K}noChangesHint`)}</p>
      )}
    </section>
  );
}

export const ApplyResult = memo(ApplyResultImpl);
