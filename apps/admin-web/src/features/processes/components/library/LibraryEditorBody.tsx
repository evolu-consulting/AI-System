// CR-105 · L3: thân editor cho quy trình thư viện (def có `slot`): thanh công cụ + Canvas (editor sẵn có) | Form + hộp thoại
// Xuất bản / Lịch sử / Gán / Xem trước / Đặt mặc định / Nhân bản. Canvas và Form chuyển được khi không có thay đổi chưa lưu
// (chuyển đổi nằm ở Hub: Form lưu `slot_body`, Canvas lưu `stages` ⇒ `fromStages`).
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { notifyError, notifySuccess } from "@/components/shared/toast";
import { useCloneFlow } from "../../hooks/use-clone-flow";
import { processErrorSpec } from "../../lib/errors";
import { type LibraryDef, setSlotDefault, useLibraryRefresh, useSlots } from "../../library-api";
import { AssignTenantsDialog } from "./AssignTenantsDialog";
import { CloneDialog } from "./CloneDialog";
import { FlowFormEditor } from "./FlowFormEditor";
import { type EditorMode, type LibraryAction, LibraryToolbar } from "./LibraryToolbar";
import { LibraryCanvasContext } from "./library-canvas-ctx";
import { PreviewDialog } from "./PreviewDialog";
import { PublishDialog } from "./PublishDialog";
import { ReleasesDialog } from "./ReleasesDialog";

type Props = {
  def: LibraryDef;
  /** Thay đổi chưa lưu ở Canvas (bản nháp editor sẵn có). */
  canvasDirty: boolean;
  /** Form báo thay đổi chưa lưu lên trang (UnsavedGuard + khoá chuyển chế độ). */
  onFormDirty: (dirty: boolean) => void;
  formDirty: boolean;
  /** Nội dung Canvas = form cấu hình sẵn có của editor. */
  canvas: ReactNode;
};

export function LibraryEditorBody({ def, canvasDirty, formDirty, onFormDirty, canvas }: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const refresh = useLibraryRefresh();
  const slots = useSlots(true);
  const [mode, setMode] = useState<EditorMode>("canvas");
  const [action, setAction] = useState<LibraryAction | null>(null);
  const cloneFlow = useCloneFlow(
    (id) => void navigate({ to: "/processes/$processId", params: { processId: id } }),
  );
  const close = () => setAction(null);
  const dirty = canvasDirty || formDirty;
  const onAction = (a: LibraryAction) =>
    a === "clone" ? cloneFlow.open({ id: def.id, name: def.name }) : setAction(a);
  const setDefault = async () => {
    if (!def.slot) return;
    try {
      await setSlotDefault(def.slot, def.id);
      notifySuccess(t("process.admin.library.default.done", { name: def.name }));
      void refresh();
    } catch (err) {
      const s = processErrorSpec(err);
      notifyError(t(s.key, s.params));
      throw err;
    }
  };
  const slot = slots.data?.find((s) => s.slot === def.slot);
  return (
    <div className="space-y-4">
      <LibraryToolbar
        def={def}
        mode={mode}
        dirty={dirty}
        busy={cloneFlow.pending}
        onMode={setMode}
        onAction={onAction}
      />
      {mode === "canvas" ? (
        <LibraryCanvasContext.Provider value={{ groups: slot?.group_keys ?? [] }}>
          {canvas}
        </LibraryCanvasContext.Provider>
      ) : (
        <FlowFormEditor
          def={def}
          slot={slot}
          onDirtyChange={onFormDirty}
          onToCanvas={() => setMode("canvas")}
        />
      )}
      <CloneDialog
        src={cloneFlow.src}
        pending={cloneFlow.pending}
        error={cloneFlow.error}
        onSubmit={(n) => void cloneFlow.submit(n)}
        onClose={cloneFlow.close}
      />
      <PublishDialog def={def} open={action === "publish"} onClose={close} />
      <ReleasesDialog def={def} open={action === "releases"} onClose={close} />
      <AssignTenantsDialog def={def} open={action === "assign"} onClose={close} />
      <PreviewDialog def={def} open={action === "preview"} onClose={close} />
      <ConfirmDialog
        open={action === "default"}
        onOpenChange={(o) => !o && close()}
        title={t("process.admin.library.default.title", { name: def.name })}
        description={t("process.admin.library.default.body", { slot: def.slot_label ?? "" })}
        confirmLabel={t("process.admin.library.default.confirm")}
        onConfirm={setDefault}
      />
    </div>
  );
}
