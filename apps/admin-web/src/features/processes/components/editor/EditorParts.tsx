// CR-127 · khối con của trình sửa quy trình (tách từ ProcessEditorPage).
import { useTranslation } from "react-i18next";
import { ForbiddenState } from "@/components/shared/states/ForbiddenState";
import { HubLoadError } from "@/components/shared/states/HubLoadError";
import { NotFoundState } from "@/components/shared/states/NotFoundState";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useLibraryView } from "@/features/tenants/flows/api";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import type { useDraft } from "../../hooks/use-draft";
import type { useFlowTrigger } from "../../hooks/use-editor-state";
import type { useProcessTenant } from "../../hooks/use-process-tenant";
import { viewerTenantId } from "../../lib/company-copy";
import { notFoundBack } from "../../lib/route-guard";
import type { LibraryDef } from "../../library-api";
import { FlowEditorBody } from "../flow/FlowEditorBody";
import { CompanyCopyBody } from "../library/CompanyCopyBody";
import { LibraryEditorBody } from "../library/LibraryEditorBody";
import { LibraryReadOnlyView } from "../library/LibraryReadOnlyView";

export function TemplateBanner() {
  const { t } = useTranslation();
  return (
    <Alert>
      <AlertDescription>{t("process.admin.editor.readonly")}</AlertDescription>
    </Alert>
  );
}

/** CR-105 · tab Cấu hình: quy trình thư viện ⇒ thanh công cụ + Canvas|Form; còn lại ⇒ form cấu hình như cũ. */
export function ConfigTab(p: {
  lib: LibraryDef | null;
  canvasDirty: boolean;
  formDirty: boolean;
  onFormDirty: (dirty: boolean) => void;
  config: React.ReactNode;
  copy: LibraryDef | null;
}) {
  if (!p.lib && p.copy)
    return <CompanyCopyBody def={p.copy} onFormDirty={p.onFormDirty} canvas={p.config} />;
  if (!p.lib) return <>{p.config}</>;
  return (
    <LibraryEditorBody
      def={p.lib}
      canvasDirty={p.canvasDirty}
      formDirty={p.formDirty}
      onFormDirty={p.onFormDirty}
      canvas={p.config}
    />
  );
}

function LoadFailure({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const status = error instanceof ApiError ? error.status : 0;
  if (status === 404) return <NotFoundState backTo={notFoundBack(role)} />;
  if (status === 403) return <ForbiddenState />;
  return <HubLoadError message={t("process.common.error.load")} onRetry={onRetry} />;
}

/** tenant_admin mở def thư viện: Hub ẩn (404) ⇒ thử đọc chỉ-xem theo công ty mình; không phải thư viện ⇒ NotFound. */
export function EditorLoadFailure(p: {
  error: unknown;
  onRetry: () => void;
  defId: string;
  tenant: ReturnType<typeof useProcessTenant>;
}) {
  const failure = <LoadFailure error={p.error} onRetry={p.onRetry} />;
  const hidden = p.error instanceof ApiError && p.error.status === 404;
  const tid = viewerTenantId(p.tenant.isPlatform, p.tenant.tenantId, p.tenant.me?.tenant.id);
  if (hidden && tid && !p.tenant.isPlatform)
    return <LibraryReadOnlyView tenantId={tid} defId={p.defId} fallback={failure} />;
  return failure;
}

export function FlowWrap(p: {
  ft: ReturnType<typeof useFlowTrigger>;
  def: LibraryDef | undefined;
  lib: LibraryDef | null;
  d: ReturnType<typeof useDraft>;
  readOnly: boolean;
  tenantId: string | undefined;
  children: React.ReactNode;
}) {
  const { src, trig, setEdit } = p.ft;
  if (!src || !trig) return <>{p.children}</>;
  return (
    <FlowEditorBody
      meta={{
        key: p.def?.key ?? "",
        name: p.d.draft.name,
        app: src.app,
        owner: p.lib ? "library" : "company",
      }}
      trigger={trig}
      stages={p.d.draft.stages}
      readOnly={p.readOnly}
      tenantId={p.tenantId}
      draft={p.d.draft}
      onChange={(next, stages) => {
        setEdit(next);
        // đã tự đánh lại đích bước (thêm/gỡ phiếu yêu cầu) ⇒ không remap lần hai (remap đôi làm lệch Từ chối/Trả lại ⇒ màn soạn chuyển chỉ xem)
        if (stages) p.d.setStages(stages, false);
      }}
    >
      {p.children}
    </FlowEditorBody>
  );
}

/** CR-121 c17 · "Sao từ thư viện: <bản gốc> · vN" của bản riêng công ty (vN = bản thư viện lúc sao). */
export function CopySourceLine(p: {
  tenantId: string | undefined;
  sourceId: string | null | undefined;
}) {
  const { t } = useTranslation();
  const src = useLibraryView(p.tenantId ?? "", p.sourceId ?? null, !!p.tenantId && !!p.sourceId);
  if (!src.data) return null;
  return (
    <p className="text-caption text-muted-foreground" data-testid="copy-source">
      {t("process.admin.editor.copySource", {
        name: src.data.name,
        n: src.data.company_copy?.rel_version ?? src.data.rel_version,
      })}
    </p>
  );
}

/** Các bước còn lỗi (theo `stages.<i>.…`) để thanh dưới chỉ đúng chỗ cần sửa. */
export function blockedSteps(
  errors: Record<string, string>,
  stages: readonly { uid: string; name: string; key: string }[],
) {
  const idx = new Set<number>();
  for (const k of Object.keys(errors)) {
    const m = /^stages\.(\d+)(?:\.|$)/.exec(k);
    if (m) idx.add(Number(m[1]));
  }
  return [...idx]
    .sort((a, b) => a - b)
    .flatMap((i) => {
      const st = stages[i];
      return st ? [{ uid: st.uid, name: st.name || st.key }] : [];
    });
}
