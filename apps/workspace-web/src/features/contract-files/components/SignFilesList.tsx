// CR-181 · s13 · «Tài liệu kèm» khi công ty bật ký trên tài liệu: mỗi tệp một dòng — Cần ký (công tắc) · Chỗ ký · Tình trạng · Xem.
// Tệp chính của HĐ là dòng đầu («Hợp đồng chính»). Công tắc chỉ bấm được với người tải lên khi HĐ chưa khoá (BR-T1).
import type { ContractOwnFile, SignFileOut, SignSessionOut } from "@ai/contracts/pack-contracts";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Switch } from "@ai/web-kit/ui/kit/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@ai/web-kit/ui/kit/tooltip";
import { useTranslation } from "react-i18next";
import { fetchContent } from "~/features/doc-sign/api";
import { fieldCounts, fileStatus, switchWhy } from "~/features/doc-sign/lib/contract-view";
import { fetchOwnFileBlob } from "../hooks/use-contract-files";
import { sizeLabel } from "../lib/files-view";
import { ViewButton } from "./ViewButton";

type Props = {
  id: string;
  session: SignSessionOut;
  own: readonly ContractOwnFile[];
  busy: boolean;
  onToggle: (fileId: string, on: boolean) => void;
  onRemove: (f: ContractOwnFile) => void;
};

function Places({ f }: { f: SignFileOut }) {
  const { t } = useTranslation();
  if (!f.needs_sign) return <span className="text-dim">—</span>;
  const c = fieldCounts(f);
  if (c.a + c.b === 0)
    return <span className="text-late">{t("contracts.docsignc.placesNone")}</span>;
  return (
    <span data-testid="sign-places">
      <span className="text-act">●</span> {c.a}
      {c.b > 0 && (
        <>
          {" · "}
          <span className="text-late">●</span> {c.b}
        </>
      )}
    </span>
  );
}

function SignRow({
  id,
  f,
  own,
  locked,
  busy,
  onToggle,
  onRemove,
}: {
  id: string;
  f: SignFileOut;
  own: ContractOwnFile | undefined;
  locked: boolean;
  busy: boolean;
  onToggle: Props["onToggle"];
  onRemove: Props["onRemove"];
}) {
  const { t } = useTranslation();
  const st = fileStatus(f);
  const why = switchWhy(f, locked);
  const hasSigned = f.latest.seq > 0;
  const meta = own ?? { name: f.name, mime: "application/pdf", size: 0, added_at: "" };
  const load = (signal: AbortSignal) =>
    f.is_pdf
      ? fetchContent(id, f.file_id, f.latest.version_id).then(
          (b) => new Blob([b], { type: "application/pdf" }),
        )
      : fetchOwnFileBlob(id, f.file_id, meta.mime, signal);
  return (
    <li
      data-testid="cfile-row"
      data-file={f.file_id}
      className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2 text-sm"
    >
      <span className="min-w-0 flex-1 basis-40">
        <span className="block truncate font-medium">{f.name}</span>
        {f.is_main && <span className="text-xs text-dim">{t("contracts.docsignc.main")}</span>}
      </span>
      {own && <span className="text-dim tabular-nums">{sizeLabel(own.size)}</span>}
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-2">
            <Switch
              data-testid="needs-sign"
              aria-label={t("contracts.docsignc.needsSign", { name: f.name })}
              checked={f.needs_sign}
              disabled={why !== null || busy}
              onCheckedChange={(on) => onToggle(f.file_id, on)}
            />
            <span>{t("contracts.docsignc.needsSignShort")}</span>
          </span>
        </TooltipTrigger>
        {why && <TooltipContent>{t(`contracts.docsignc.switchWhy.${why}`)}</TooltipContent>}
      </Tooltip>
      <Places f={f} />
      <span data-testid="sign-status" data-status={st.kind}>
        {st.kind === "partial"
          ? `${t("contracts.docsignc.status.partial")} (${st.signed}/${st.total})`
          : t(`contracts.docsignc.status.${st.kind}`)}
      </span>
      {(f.is_pdf || own) && (
        <ViewButton f={meta} cacheKey={["sign-file", id, f.file_id, f.latest.seq]} load={load} />
      )}
      {hasSigned && (
        <Button asChild variant="outline" size="sm">
          <a
            href={`/contracts/signed/${encodeURIComponent(id)}?file=${encodeURIComponent(f.file_id)}`}
            data-testid="view-signed"
          >
            {t("contracts.docsignc.viewSigned")}
          </a>
        </Button>
      )}
      {own?.can_remove && (
        <Button variant="quiet" size="sm" disabled={busy} onClick={() => onRemove(own)}>
          {t("contracts.cfiles.remove")}
        </Button>
      )}
    </li>
  );
}

export function SignFilesList({ id, session, own, busy, onToggle, onRemove }: Props) {
  const files = [...session.files].sort((a, b) => Number(b.is_main) - Number(a.is_main));
  return (
    <ul className="mt-2 divide-y divide-rule" data-testid="cfiles-own">
      {files.map((f) => (
        <SignRow
          key={f.file_id}
          id={id}
          f={f}
          own={own.find((o) => o.id === f.file_id)}
          locked={session.locked}
          busy={busy}
          onToggle={onToggle}
          onRemove={onRemove}
        />
      ))}
    </ul>
  );
}
