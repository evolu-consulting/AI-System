// HUB-FR-128 · P-c1 §1.2/§6 · danh sách file + diff hợp nhất. `<details>` mỗi file; nội dung chỉ mount khi mở; văn bản thuần (không HTML).
import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DiffFile, DiffLineKind, ParsedDiff } from "../lib/diff-parse";
import { Badge } from "./Badge";

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

function FileItem({
  file,
  index,
  open,
  onOpen,
}: {
  file: DiffFile;
  index: number;
  open: boolean;
  onOpen: (v: boolean) => void;
}) {
  return (
    <details
      id={`autofix-file-${index}`}
      open={open}
      data-testid={`autofix-diff-file-${index}`}
      className="rounded-md border border-border"
      onToggle={(e) => onOpen(e.currentTarget.open)}
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-2 px-2 py-1.5 text-sm">
        <span title={file.path} className="min-w-0 break-all font-mono">
          {file.path}
        </span>
      </summary>
      {open && <FileBody file={file} />}
    </details>
  );
}

/** Cột trái (mockup Pc-Diff): tên file + `+a −d` / "nhị phân"; bấm ⇒ mở file ở cột phải. */
function FileList({ files, onPick }: { files: DiffFile[]; onPick: (i: number) => void }) {
  const { t } = useTranslation();
  return (
    <ul
      aria-label={t("process.common.autofix.files")}
      className="m-0 flex list-none flex-col gap-1 p-0 text-caption"
    >
      {files.map((f, i) => (
        <li key={f.path}>
          <button
            type="button"
            title={f.path}
            className="flex w-full flex-wrap items-center gap-x-2 rounded-sm px-1 py-0.5 text-left hover:bg-accent"
            onClick={() => onPick(i)}
          >
            <span className="min-w-0 break-all font-mono">{f.path}</span>
            {f.binary ? <Badge variant="off">{t("process.common.autofix.binary")}</Badge> : null}
          </button>
        </li>
      ))}
    </ul>
  );
}

function DiffViewImpl({ parsed }: { parsed: ParsedDiff }) {
  const [open, setOpen] = useState<Set<number>>(() => new Set([0]));
  const set = (i: number, v: boolean) =>
    setOpen((o) => {
      if (o.has(i) === v) return o;
      const n = new Set(o);
      if (v) n.add(i);
      else n.delete(i);
      return n;
    });
  const pick = (i: number) => {
    set(i, true);
    document.getElementById(`autofix-file-${i}`)?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <div className="grid gap-3 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
      <FileList files={parsed.files} onPick={pick} />
      <div className="flex min-w-0 flex-col gap-2">
        {parsed.files.map((f, i) => (
          <FileItem key={f.path} file={f} index={i} open={open.has(i)} onOpen={(v) => set(i, v)} />
        ))}
      </div>
    </div>
  );
}

export const DiffView = memo(DiffViewImpl);
