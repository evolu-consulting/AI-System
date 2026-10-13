// HUB-FR-128 · P-c1 §1.2/§6 · danh sách file + diff hợp nhất. `<details>` mỗi file; nội dung chỉ mount khi mở; văn bản thuần (không HTML).
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffFile, DiffLineKind, ParsedDiff } from "../lib/diff-parse";

const PREFIX: Record<DiffLineKind, string> = { add: "+", del: "-", ctx: " ", note: "\\" };
const TONE: Record<DiffLineKind, string> = {
  add: "bg-success-bg",
  del: "bg-destructive/10",
  ctx: "",
  note: "text-muted-foreground",
};

function FileBody({ file }: { file: DiffFile }) {
  const { t } = useTranslation();
  if (file.binary) {
    return (
      <p className="p-2 text-caption text-muted-foreground">
        {t("process.common.autofix.binaryNote")}
      </p>
    );
  }
  return (
    <div className="overflow-x-auto font-mono text-caption">
      {file.hunks.map((h, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: hunk không có id; bất biến theo text
        <div key={i}>
          <div className="bg-muted px-2 py-0.5 text-muted-foreground">{h.header}</div>
          {h.lines.map((l, j) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: dòng diff không có id
            <div key={j} className={`flex whitespace-pre-wrap break-all px-2 ${TONE[l.kind]}`}>
              <span aria-hidden className="w-4 shrink-0 select-none">
                {PREFIX[l.kind]}
              </span>
              <span>{l.text}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function FileItem({ file, index }: { file: DiffFile; index: number }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(index === 0);
  return (
    <li className="rounded-md border border-border">
      <details
        open={open}
        data-testid={`autofix-diff-file-${index}`}
        onToggle={(e) => setOpen(e.currentTarget.open)}
      >
        <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
          <span title={file.path} className="min-w-0 break-all font-mono">
            {file.path}
          </span>
          {file.binary && (
            <span className="rounded-sm bg-muted px-1.5 text-caption">
              {t("process.common.autofix.binary")}
            </span>
          )}
        </summary>
        {open && <FileBody file={file} />}
      </details>
    </li>
  );
}

function DiffViewImpl({ parsed }: { parsed: ParsedDiff }) {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("process.common.autofix.files")}
      className="m-0 flex list-none flex-col gap-2 p-0"
    >
      {parsed.files.map((f, i) => (
        <FileItem key={f.path} file={f} index={i} />
      ))}
    </ul>
  );
}

export const DiffView = memo(DiffViewImpl);
