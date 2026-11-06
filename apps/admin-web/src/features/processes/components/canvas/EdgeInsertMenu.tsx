// CR-122 · P8: nút "+" giữa cạnh — mở cùng menu "Thêm bước" nhưng chèn node vào GIỮA hai node (nhánh Đúng/Sai ⇒ nằm trên nhánh đó).
import { Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DropdownMenu, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { StageOps } from "../../hooks/use-stage-ops";
import type { EdgeRef } from "../../lib/insert-on-edge";
import { NodeMenuContent } from "../flow/NodeMenuContent";

type Props = { edge: EdgeRef; ops: StageOps; room: number };

export function EdgeInsertMenu({ edge, ops, room }: Props) {
  const { t } = useTranslation();
  const label = t("process.admin.flow.insertOnEdge");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={label}
          title={label}
          disabled={room < 1}
          data-testid={`flow-edge-insert-${edge.from}-${edge.to}`}
          className="flex size-6 items-center justify-center rounded-full border border-border bg-card text-muted-foreground shadow-sm hover:bg-accent hover:text-accent-foreground focus-visible:outline-2 disabled:opacity-40"
        >
          <Plus aria-hidden className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <NodeMenuContent align="center" room={room} pick={(items) => ops.insertNodes(items, edge)} />
    </DropdownMenu>
  );
}
