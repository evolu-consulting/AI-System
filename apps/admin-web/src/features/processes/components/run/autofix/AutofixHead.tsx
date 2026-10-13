// HUB-FR-128 · P-c1 §1.2 · đầu khối kết quả tự sửa: vòng, nguồn@sha7, nhánh, +i −d, kiểm, Xem log / Tải log / Tải .diff.
import type { AutofixStageView } from "@ai/contracts/chat";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { secondsLabel, shortBranch, sourceLabel } from "../../../lib/autofix-view";
import { LogDialog } from "./LogDialog";
import { type LoadContent, useDownload } from "./use-autofix-content";

const K = "process.common.autofix.";
const chip = "rounded-sm bg-muted px-1.5 py-0.5 text-caption font-medium";

export function AutofixHead({ view, load }: { view: AutofixStageView; load: LoadContent }) {
  const { t, i18n } = useTranslation();
  const [logOpen, setLogOpen] = useState(false);
  const download = useDownload(load);
  const st = view.diff_stats;
  const test = view.test;
  const sec = secondsLabel(test?.duration_ms ?? 0, i18n.language);
  const log = view.test_log_file;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-sm font-semibold">{t(`${K}title`)}</span>
      <span className={chip}>{t(`${K}round`, { n: view.round })}</span>
      <span className="font-mono text-caption">{sourceLabel(view)}</span>
      <span title={view.branch} className="font-mono text-caption text-muted-foreground">
        {shortBranch(view.branch)}
      </span>
      {st && (
        <>
          <span className="text-caption font-medium text-success">{`+${st.insertions}`}</span>
          <span className="text-caption font-medium text-destructive">{`−${st.deletions}`}</span>
          <span className="text-caption text-muted-foreground">
            {t(`${K}diffStat`, { n: st.files })}
          </span>
        </>
      )}
      {test && (
        <span className={chip}>
          {test.exit_code === 0
            ? t(`${K}testOk`, { sec })
            : t(`${K}testFail`, { code: test.exit_code ?? "-", sec })}
        </span>
      )}
      <span className="ml-auto flex flex-wrap gap-1">
        {log && (
          <>
            <Button type="button" size="sm" variant="ghost" onClick={() => setLogOpen(true)}>
              {t(`${K}viewLog`)}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => void download(log)}>
              {t(`${K}downloadLog`)}
            </Button>
          </>
        )}
        {view.diff_file && <DownloadDiff file={view.diff_file} onDownload={download} />}
      </span>
      {log && (
        <LogDialog
          open={logOpen}
          onOpenChange={setLogOpen}
          fileId={log.id}
          load={load}
          onDownload={() => void download(log)}
        />
      )}
    </div>
  );
}

function DownloadDiff({
  file,
  onDownload,
}: {
  file: { id: string; name: string };
  onDownload: (f: { id: string; name: string }) => Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <Button type="button" size="sm" variant="ghost" onClick={() => void onDownload(file)}>
      {t(`${K}downloadDiff`)}
    </Button>
  );
}
