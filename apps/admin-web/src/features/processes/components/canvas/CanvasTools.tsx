// ADM-FR-71 · CR-123 · p25: cụm công cụ bên phải thanh trên của bàn làm việc — đổi Sơ đồ/Danh sách, hoàn tác/làm lại, phím tắt.
import type { DraftState } from "../../hooks/use-draft";
import { writeViewMode } from "../../lib/view-mode";
import { ViewModeToggle } from "../ViewModeToggle";
import { ShortcutsHint } from "./ShortcutsHint";
import { UndoRedoButtons } from "./UndoRedoButtons";
import type { Workbench } from "./use-workbench";

type Props = { d: DraftState; w: Workbench; readOnly: boolean; lib: boolean };

export function CanvasTools({ d, w, readOnly, lib }: Props) {
  return (
    <div className="ml-auto flex items-center gap-1">
      {lib ? null : (
        <ViewModeToggle
          mode={w.mode}
          set={(m) => {
            writeViewMode(m);
            w.setMode(m);
          }}
        />
      )}
      {readOnly || lib ? null : <UndoRedoButtons d={d} ops={w.ops} />}
      <ShortcutsHint />
    </div>
  );
}
