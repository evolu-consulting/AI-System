// CR-181 · s14 · màn «Xem bản đã ký» `/contracts/signed/:id?file=&v=`: chỉ xem, không có gì sửa được.
import type { SignSide, SignVersionItemOut } from "@ai/contracts/pack-contracts";
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { SignedViewer } from "../components/SignedViewer";
import { ViewerTabs } from "../components/ViewerTabs";
import { ViewerTopBar } from "../components/ViewerTopBar";
import { useDownloadPdf, useSignedSession, useSignedVersions } from "../hooks/use-signed-view";
import { signFiles } from "../lib/session-map";
import { latestVersion, pickVersion, versionKey, versionLabel } from "../lib/viewer-model";

export type SignedViewNav = { file?: string; v?: string };

export function SignedScreen(p: {
  id: string;
  file?: string;
  v?: string;
  onNav: (n: SignedViewNav) => void;
  onBack: () => void;
}) {
  const { t, i18n } = useTranslation();
  const session = useSignedSession(p.id);
  const list = session.data ? signFiles(session.data) : [];
  const file = list.find((f) => f.file_id === p.file) ?? list[0];
  const versions = useSignedVersions(p.id, file?.file_id);
  const download = useDownloadPdf();
  const data = versions.data;
  const current = data ? pickVersion(data.versions, p.v) : undefined;
  const sideByField = useMemo(() => {
    const m: Record<string, SignSide> = {};
    for (const f of file?.fields ?? []) m[f.id] = f.side;
    return m;
  }, [file]);
  const at = (iso: string | null) =>
    iso
      ? new Date(iso).toLocaleString(i18n.language, { dateStyle: "short", timeStyle: "short" })
      : "";
  const labelOf = (v: SignVersionItemOut) => {
    const l = versionLabel(v, t("contracts.docsign.viewer.unknownSigner"), at(v.signed_at));
    const text =
      l.key === "contracts.docsign.viewer.original" ? t(l.key) : t(l.key, { who: l.who, at: l.at });
    return v.voided ? `${text} ${t("contracts.docsign.viewer.voided")}` : text;
  };
  if (session.isPending)
    return <p className="p-6 text-sm text-muted-foreground">{t("contracts.docsign.loading")}</p>;
  if (session.isError || !session.data)
    return (
      <div role="alert" className="p-6 text-sm" data-testid="viewer-unavailable">
        {t("contracts.docsign.viewer.unavailable")}
      </div>
    );
  if (!file)
    return (
      <div role="alert" className="p-6 text-sm" data-testid="viewer-unavailable">
        {t("contracts.docsign.viewer.noSignFiles")}
      </div>
    );
  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-background" data-testid="signed-viewer">
      <ViewerTopBar
        versions={data?.versions ?? []}
        current={current}
        labelOf={labelOf}
        onVersion={(key) => {
          const v = data?.versions.find((x) => versionKey(x) === key);
          p.onNav({ file: file.file_id, v: v ? versionKey(v) : undefined });
        }}
        onBack={p.onBack}
        onDownload={(path) => void download(path, data?.name ?? file.name)}
      />
      <ViewerTabs files={list} active={file.file_id} onSelect={(fid) => p.onNav({ file: fid })} />
      {versions.isError && (
        <p role="alert" className="m-auto text-sm text-destructive">
          {t("contracts.docsign.viewer.unavailable")}
        </p>
      )}
      {data && (
        <SignedViewer
          key={file.file_id}
          id={p.id}
          fileId={file.file_id}
          data={data}
          v={current}
          sideByField={sideByField}
          atOf={at}
          isLatest={!!current && current === latestVersion(data.versions)}
        />
      )}
    </div>
  );
}
