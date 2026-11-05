// CR-118 · cr118-app-config · "Xem trước": chọn công ty (tuỳ chọn) · vai · bản đang lưu/bản nháp, rồi hiện PreviewPanel. Dùng ở tab Xem trước
// (chọn công ty) và trong ngăn của tab Công ty (công ty đã chọn, có bản nháp chưa lưu).
import { type AppManifest, PREVIEW_ROLES, type PreviewRole } from "@ai/contracts/app-manifest";
import { useTranslation } from "react-i18next";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { LoadingState } from "@/components/shared/states/LoadingState";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { loadError } from "@/lib/load-error";
import { useCompanyPreview } from "../hooks/use-company-preview";
import { effectiveVersion, type PreviewVersion } from "../lib/app-config";
import { PreviewPanel } from "./PreviewPanel";

type Props = {
  manifest: AppManifest;
  tenantId: string | undefined;
  /** Tập key feature chưa lưu của công ty (null = không có thay đổi). */
  draft: ReadonlySet<string> | null;
  role: PreviewRole;
  onRole: (r: PreviewRole) => void;
  version: PreviewVersion;
  onVersion: (v: PreviewVersion) => void;
  /** Chọn công ty (tab Xem trước); vắng ⇒ công ty cố định (ngăn của tab Công ty). */
  picker?: React.ReactNode;
};

export function AppPreview({
  manifest,
  tenantId,
  draft,
  role,
  onRole,
  version,
  onVersion,
  picker,
}: Props) {
  const { t } = useTranslation();
  const v = effectiveVersion(version, draft !== null);
  const q = useCompanyPreview(tenantId, manifest, v, draft);
  const err = loadError(q.error);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        {picker}
        <ToggleGroup
          type="single"
          value={role}
          aria-label={t("appcfg.preview.roleAria")}
          onValueChange={(r) => r && onRole(r as PreviewRole)}
        >
          {PREVIEW_ROLES.map((r) => (
            <ToggleGroupItem key={r} value={r} className="px-3">
              {t(`appcfg.preview.role.${r}`)}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <ToggleGroup
          type="single"
          value={v}
          aria-label={t("appcfg.preview.versionAria")}
          onValueChange={(x) => x && onVersion(x as PreviewVersion)}
        >
          <ToggleGroupItem value="saved" className="px-3">
            {t("appcfg.preview.saved")}
          </ToggleGroupItem>
          <ToggleGroupItem value="draft" disabled={draft === null} className="px-3">
            {t("appcfg.preview.draft")}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      {draft === null ? (
        <p className="text-caption text-muted-foreground">{t("appcfg.preview.draftHint")}</p>
      ) : null}
      {!tenantId ? (
        <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-body text-muted-foreground">
          {t("appcfg.preview.pickCompany")}
        </p>
      ) : err ? (
        <ErrorState message={err.message} code={err.code} onRetry={q.refetch} />
      ) : q.pending || !q.result ? (
        <LoadingState />
      ) : (
        <PreviewPanel appName={manifest.name} role={role} data={q.result[role]} />
      )}
    </div>
  );
}
