// CR-121 c17b · bản RIÊNG của công ty: cùng công tắc Sơ đồ/Danh sách (view-mode.ts) và CÙNG Form bước dọc của thư viện (FlowFormEditor — một
// component, Luật gốc 2). Sơ đồ = trình sửa giai đoạn có sẵn (children); Danh sách = Form có "Chỉ chạy khi", n/20, "Thêm bước". Lưu theo đường
// khe (Hub dựng lại stages từ slot_body, c17); bước song song/If chỉ sửa được ở Sơ đồ (Form báo lý do).
import type { ReactNode } from "react";
import { useViewMode } from "../../hooks/use-view-mode";
import type { LibraryDef } from "../../library-api";
import { ViewModeToggle } from "../ViewModeToggle";
import { FlowFormEditor } from "./FlowFormEditor";

type Props = {
  def: LibraryDef;
  onFormDirty: (dirty: boolean) => void;
  /** Sơ đồ: trình sửa giai đoạn sẵn có. */
  canvas: ReactNode;
};

export function CompanyCopyBody({ def, onFormDirty, canvas }: Props) {
  const [mode, setMode] = useViewMode();
  return (
    <div className="space-y-4" data-testid="company-copy-body">
      <div className="flex flex-wrap items-center gap-2">
        <ViewModeToggle mode={mode} set={setMode} />
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
    </div>
  );
}
