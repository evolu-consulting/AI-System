// CR-144 · nội dung hộp «Xem» của hồ sơ duyệt: người duyệt (+ thay/duyệt thay), bước, thời điểm, quyết định, ý kiến, chữ ký, tệp.
// Thuần trình bày: `urls` là blob URL đã tải (fileId → URL); chưa có ⇒ «Đang tải», `failed` ⇒ báo lỗi.
import { FileText } from "lucide-react";
import { useTranslation } from "react-i18next";
import { evidenceKind } from "../lib/evidence-kind";
import type { RecordLine } from "../lib/record-view";

export type EvidenceUrls = {
  urls: Readonly<Record<string, string>>;
  failed: ReadonlySet<string>;
};

/** Loại không xem trước được ⇒ link nhỏ «Tải về» (ảnh/PDF không có). Blob URL của tệp đó do hộp tải khi mở. */
function OtherFile({ f, url }: { f: RecordLine["files"][number]; url: string | undefined }) {
  const { t } = useTranslation();
  return (
    <p className="m-0 flex flex-wrap items-center gap-2 text-sm" data-testid="evidence-other">
      <FileText size={16} aria-hidden /> {f.name}
      {url && (
        <a
          href={url}
          download={f.name}
          className="text-caption text-act underline"
          data-testid="evidence-download"
        >
          {t("contracts.work.u4.record.download")}
        </a>
      )}
    </p>
  );
}

function FileBlock({ f, u }: { f: RecordLine["files"][number]; u: EvidenceUrls }) {
  const { t } = useTranslation();
  const kind = evidenceKind(f.mime);
  const url = u.urls[f.id];
  if (u.failed.has(f.id))
    return (
      <p role="alert" className="m-0 text-caption text-late">
        {t("contracts.work.u4.record.fileError")}
      </p>
    );
  if (kind === "other") return <OtherFile f={f} url={url} />;
  if (!url) return <p className="m-0 text-caption text-dim">{t("contracts.common.loading")}</p>;
  return kind === "image" ? (
    <img
      src={url}
      alt={f.name}
      className="max-h-80 max-w-full rounded-lg border border-line"
      data-testid="evidence-image"
    />
  ) : (
    <iframe
      src={url}
      title={f.name}
      className="h-96 w-full rounded-lg border border-line"
      data-testid="evidence-pdf"
    />
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
