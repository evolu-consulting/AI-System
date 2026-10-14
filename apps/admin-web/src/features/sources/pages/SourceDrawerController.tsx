// ADM-FR-68 · HUB-BR-30 · PB-R21 · nối drawer với API: nạp nguồn (sửa/xem), lưu, kiểm tra kết nối, ánh xạ lỗi vào ô.
// GATING (rủi ro cao): chế độ hiệu lực = `view` khi tenant_admin mở nguồn local_path (kể cả URL `?drawer=edit`) ⇒ không có form,
// không có `path`. `toFormValues` nhận cấu hình đầy đủ chỉ qua `toFullConfig` (bản công khai ⇒ null).
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { LazyConflictDialog } from "@/components/shared/conflict/LazyConflictDialog";
import { useSession } from "@/lib/auth/use-session";
import { useSource } from "../api";
import { SourceDrawer } from "../components/SourceDrawer";
import { SourceDrawerBody } from "../components/SourceDrawerBody";
import { useLibraryDocPicker } from "../hooks/use-library-doc-picker";
import { useSourceCheck } from "../hooks/use-source-check";
import { useSourceSave } from "../hooks/use-source-save";
import { EMPTY_SOURCE_FORM, type SourceFormValues, toFormValues } from "../lib/schemas";
import { gitCredState, isViewOnly, toFullConfig } from "../lib/source-view";

type Props = {
  mode: "new" | "edit" | "view";
  sourceKey: string | undefined;
  tenantId: string | undefined;
  tenantKey: string | null;
  tenants: { id: string; key: string }[];
  /** Mở từ menu dòng "Kiểm tra kết nối": tự chạy kiểm tra khi nguồn đã nạp. */
  autoCheck: boolean;
  onClose: () => void;
};

const FORM_ID = "source-form";

export function SourceDrawerController(p: Props) {
  const { t } = useTranslation();
  const role = useSession((s) => s.me?.role);
  const isPlatform = role === "platform_admin";
  const isNew = p.mode === "new";
  const lookup = useSource(p.sourceKey, p.tenantId, !isNew);
  const src = lookup.data;
  const [dirty, setDirty] = useState(false);
  const picker = useLibraryDocPicker(p.tenantId, true);
  const check = useSourceCheck(p.tenantId);
  const save = useSourceSave({
    mode: isNew ? "new" : "edit",
    source: src,
    tenantId: p.tenantId,
    tenants: p.tenants,
    isPlatform,
    onDone: p.onClose,
    onReload: () => void lookup.refetch(),
  });
  const viewOnly = !!src && isViewOnly(src.kind, role);
  const notFound = !isNew && lookup.isError;
  const ready = isNew || !!src;
  const savedBranch = src?.config.kind === "git_remote" ? src.config.branch : undefined;
  const gitCred = src ? gitCredState(src.config) : null; // PC2-R10 · map SOURCE_UNRESOLVABLE khi kiểm tra
  const runCheck = () => src && void check.run(src.key, savedBranch, gitCred);

  const started = useRef(false);
  const { run } = check;
  useEffect(() => {
    if (started.current || !p.autoCheck || !src || viewOnly) return;
    started.current = true;
    void run(src.key, savedBranch, gitCred);
  }, [p.autoCheck, src, viewOnly, savedBranch, gitCred, run]);

  const defaults: SourceFormValues = src
    ? toFormValues(src, toFullConfig(src.config))
    : { ...EMPTY_SOURCE_FORM, tenant: p.tenantKey ?? "" };
  const key = p.sourceKey ?? "";
  let title = t("process.sources.drawer.edit", { key });
  if (notFound) title = t("state.notFound.title");
  else if (isNew) title = t("process.sources.drawer.new");
  else if (viewOnly) title = t("process.sources.drawer.view", { key });

  return (
    <>
      <SourceDrawer
        title={title}
        canSave={ready && !viewOnly && !notFound}
        pending={save.pending}
        dirty={dirty}
        formId={FORM_ID}
        onClose={p.onClose}
      >
        <SourceDrawerBody
          notFound={notFound}
          ready={ready}
          viewOnly={viewOnly}
          source={src}
          alertKey={save.alertKey}
          form={{
            formId: FORM_ID,
            mode: isNew ? "new" : "edit",
            isPlatform,
            tenantId: p.tenantId,
            defaults,
            tenants: p.tenants,
            picker,
            serverErrors: save.errors,
            onDirtyChange: setDirty,
            onSubmit: save.submit,
          }}
          check={{ state: check.state, dirty, onRun: runCheck }}
        />
      </SourceDrawer>
      <LazyConflictDialog props={save.conflictProps} />
    </>
  );
}
