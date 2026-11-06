// CR-122 · U2d · FLOW2-FR-15/25: MỘT nút "+ Thêm bước" mở danh sách node theo nhóm (Lõi · từng ứng dụng) thay cho hàng 13 nút.
// Node dựng sẵn (Duyệt, Điền thông tin, Nếu, Agent, Công cụ, Ghi giá trị, Kết thúc) + node lõi/module từ `GET /process-palette`.
// Chèn node bảng ghi `stage.node`; mỗi stage mẫu thành một bước mới cuối (muốn chèn giữa: nút "+" trên cạnh, `EdgeInsertMenu`).
import { LayoutTemplate, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { StageOps } from "../../hooks/use-stage-ops";
import { useFlowCtx } from "./flow-ctx";
import { NodeMenuContent } from "./NodeMenuContent";

type Props = { ops: StageOps; count: number; max: number };

/** Có ngữ cảnh flow ⇒ bảng node theo manifest; không ⇒ thanh công cụ giai đoạn thường (children). */
export function FlowToolbar({
  children,
  ...p
}: Props & { children: React.ReactNode }): React.ReactNode {
  return useFlowCtx() ? <NodePalette {...p} /> : children;
}

export function NodePalette({ ops, count, max }: Props) {
  const { t } = useTranslation();
  const ctx = useFlowCtx();
  if (!ctx) return null;
  const full = count >= max;
  return (
    <div className="flex flex-wrap items-center gap-2 scroll-mt-40" data-testid="flow-palette">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button" size="sm" disabled={full} data-testid="flow-add-step">
            <Plus aria-hidden className="size-4" />
            {t("process.admin.flow.add")}
          </Button>
        </DropdownMenuTrigger>
        <NodeMenuContent
          room={max - count}
          pick={(items) => {
            for (const i of items) ops.addNode(i.patch, i.name);
          }}
        />
      </DropdownMenu>
      <Button type="button" variant="ghost" size="sm" onClick={ops.arrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
      {full ? (
        <span className="text-caption text-muted-foreground">
          {t("process.admin.canvas.err.stagesMax")}
        </span>
      ) : null}
    </div>
  );
}
