// CR-105 · L3: thân editor cho quy trình thư viện (def có `slot`): thanh công cụ + Canvas (editor sẵn có) | Form + hộp thoại
// Xuất bản / Lịch sử / Gán / Xem trước / Đặt mặc định / Nhân bản. Canvas và Form chuyển được khi không có thay đổi chưa lưu
// (chuyển đổi nằm ở Hub: Form lưu `slot_body`, Canvas lưu `stages` ⇒ `fromStages`).

import { notifyError, notifySuccess } from "@ai/web-kit/ui/toast";
import { useNavigate } from "@tanstack/react-router";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/shared/ConfirmDialog";
import { useDlcStepTemplates } from "../../dlc-steps-api";
import { useCloneFlow } from "../../hooks/use-clone-flow";
import { isDlcSlotKey } from "../../lib/dlc-slot";
import { processErrorSpec } from "../../lib/errors";
import { hasTrigger } from "../../lib/flow-def";
import type { PublishIssue } from "../../lib/publish-issues";
import { editorModeOf, viewModeOf } from "../../lib/step-limit";
import { readViewMode, writeViewMode } from "../../lib/view-mode";
import { type LibraryDef, setSlotDefault, useLibraryRefresh, useSlots } from "../../library-api";
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
  const dlcSteps = useDlcStepTemplates(isDlcSlotKey(def.slot));
  // Q11: Sơ đồ (canvas) mặc định, "Danh sách" (= Form) là chế độ phụ; nhớ theo người dùng (cùng `view-mode.ts` với mọi nơi xem quy trình).
  // CR-122 · flow có trigger: MỘT trình sửa canvas (Danh sách = chế độ phụ của canvas), không còn Form theo khe.
  const flow = hasTrigger(def);
  const [modeState, setModeState] = useState<EditorMode>(() => editorModeOf(readViewMode()));
  const mode: EditorMode = flow ? "canvas" : modeState;
  const setMode = (m: EditorMode) => {
    writeViewMode(viewModeOf(m));
    setModeState(m);
  };
  const [action, setAction] = useState<LibraryAction | null>(null);
  // CR-121 D-3: lỗi xuất bản (bước, trường, câu sửa) hiện ở thanh trạng thái Form; bản nháp đổi ⇒ lỗi cũ hết hiệu lực.
  const [pubIssues, setPubIssues] = useState<PublishIssue[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: chỉ xoá khi phiên bản nháp đổi
  useEffect(() => setPubIssues([]), [def.id, def.version]);
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
      {mode === "canvas" && flow ? (
        // CR-122 · U2c: flow có trigger dùng form giai đoạn chung (không còn form bước theo khe của Canvas thư viện cũ).
        canvas
      ) : mode === "canvas" ? (
        <LibraryCanvasContext.Provider
          value={{ groups: slot?.group_keys ?? [], dlcSteps: dlcSteps.data ?? [] }}
        >
          {canvas}
        </LibraryCanvasContext.Provider>
      ) : (
        <FlowFormEditor
          def={def}
          slot={slot}
          onDirtyChange={onFormDirty}
          onToCanvas={() => setMode("canvas")}
          publishIssues={pubIssues}
        />
      )}
      <CloneDialog
        src={cloneFlow.src}
        pending={cloneFlow.pending}
        error={cloneFlow.error}
        onSubmit={(n) => void cloneFlow.submit(n)}
        onClose={cloneFlow.close}
      />
      <PublishDialog
        def={def}
        open={action === "publish"}
        onClose={close}
        onIssues={setPubIssues}
      />
      <ReleasesDialog def={def} open={action === "releases"} onClose={close} />
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
