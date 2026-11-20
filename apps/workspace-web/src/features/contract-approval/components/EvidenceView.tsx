// CR-144 · nội dung hộp «Xem» của hồ sơ duyệt: người duyệt (+ thay/duyệt thay), bước, thời điểm, quyết định, ý kiến, chữ ký, tệp.
// Thuần trình bày: `urls` là blob URL đã tải (fileId → URL); chưa có ⇒ «Đang tải», `failed` ⇒ báo lỗi.

import { viewerKind } from "@ai/web-kit/viewer-kind";
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DownloadLink, FilePreview } from "~/components/shared/file-viewer/FilePreview";
import type { RecordLine } from "../lib/record-view";

export type EvidenceUrls = {
  blobs: Readonly<Record<string, Blob>>;
  failed: ReadonlySet<string>;
};

/** Loại không xem trước được ⇒ tên + link nhỏ «Tải về» (ảnh/PDF/Word hiện thẳng, không có link). */
function OtherFile({ f, blob }: { f: RecordLine["files"][number]; blob: Blob | undefined }) {
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-sm" data-testid="evidence-other">
      <FileText size={16} aria-hidden /> {f.name}
      {blob && <DownloadLink blob={blob} name={f.name} small />}
    </p>
  );
}

function FileBlock({ f, u }: { f: RecordLine["files"][number]; u: EvidenceUrls }) {
  const { t } = useTranslation();
  const blob = u.blobs[f.id];
  if (u.failed.has(f.id))
    return (
      <p role="alert" className="m-0 text-caption text-late">
        {t("contracts.work.u4.record.fileError")}
      </p>
    );
  if (viewerKind(f.mime, f.name) === "other") return <OtherFile f={f} blob={blob} />;
  if (!blob) return <p className="m-0 text-caption text-dim">{t("contracts.common.loading")}</p>;
  return (
    <div className="flex h-96 flex-col" data-testid="evidence-file">
      <FilePreview blob={blob} name={f.name} mime={f.mime} />
    </div>
  );
}

export function EvidenceView({ line, u }: { line: RecordLine; u: EvidenceUrls }) {
  const { t, i18n } = useTranslation();
  const k = (s: string, o?: Record<string, string>) => t(`contracts.work.u4.record.${s}`, o);
  const sig = line.files.find((f) => f.id === line.signatureId);
  const rest = line.files.filter((f) => f.id !== line.signatureId);
  const row = (label: string, v: string) => (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-dim">{label}</dt>
      <dd className="m-0">{v}</dd>
    </div>
  );
  const who = [
    line.who,
    line.onBehalf ? `(${k("behalf", { who: line.onBehalf })})` : "",
    line.override ? `(${k("override")})` : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className="grid gap-3 text-sm" data-testid="evidence-view">
      <dl className="m-0 grid gap-1">
        {row(k("by"), who)}
        {row(k("stage"), line.stage ?? k("stageFallback"))}
        {row(k("at"), new Date(line.at).toLocaleString(i18n.language))}
        {row(k("decision"), k(`action.${line.action}`))}
        {line.note ? row(k("note"), line.note) : null}
      </dl>
      {sig && (
        <section data-testid="evidence-signature">
          <h3 className="m-0 mb-1 text-sm font-semibold">{k("signatureTitle")}</h3>
          <FileBlock f={sig} u={u} />
        </section>
      )}
      {rest.length > 0 && (
        <section>
          <h3 className="m-0 mb-1 text-sm font-semibold">{k("file")}</h3>
          <div className="grid gap-2">
            {rest.map((f) => (
              <FileBlock key={f.id} f={f} u={u} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
