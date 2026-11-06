// CR-121 c17b · bản RIÊNG của công ty: cùng công tắc Sơ đồ/Danh sách (view-mode.ts) và CÙNG Form bước dọc của thư viện (FlowFormEditor — một
// component, Luật gốc 2). Sơ đồ = trình sửa giai đoạn có sẵn (children); Danh sách = Form có "Chỉ chạy khi", n/20, "Thêm bước". Lưu theo đường
// khe (Hub dựng lại stages từ slot_body, c17); bước song song/If chỉ sửa được ở Sơ đồ (Form báo lý do). Xem trước bằng HĐ mẫu = PreviewDialog.
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useViewMode } from "../../hooks/use-view-mode";
import type { LibraryDef } from "../../library-api";
import { ViewModeToggle } from "../ViewModeToggle";
import { FlowFormEditor } from "./FlowFormEditor";
import { PreviewDialog } from "./PreviewDialog";

type Props = {
  def: LibraryDef;
  onFormDirty: (dirty: boolean) => void;
  /** Sơ đồ: trình sửa giai đoạn sẵn có. */
  canvas: ReactNode;
};

export function CompanyCopyBody({ def, onFormDirty, canvas }: Props) {
  const { t } = useTranslation();
  const [mode, setMode] = useViewMode();
  const [preview, setPreview] = useState(false);
  return (
    <div className="space-y-4" data-testid="company-copy-body">
      <div className="flex flex-wrap items-center gap-2">
        <ViewModeToggle mode={mode} set={setMode} />
        <span className="ml-auto" />
        <Button type="button" variant="outline" size="sm" onClick={() => setPreview(true)}>
          {t("process.admin.library.preview.button")}
        </Button>
      </div>
      {mode === "list" ? (
        <FlowFormEditor
          companyCopy
          def={def}
          slot={undefined}
          onDirtyChange={onFormDirty}
          onToCanvas={() => setMode("canvas")}
        />
      ) : (
        canvas
      )}
      <PreviewDialog def={def} open={preview} onClose={() => setPreview(false)} />
    </div>
  );
}
