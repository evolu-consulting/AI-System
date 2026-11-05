// CR-105 UX · thanh công cụ Canvas của quy trình khe + "Sắp xếp". dlc-engine: nút thêm là nút TÁCH — bấm phần chính = "Thêm bước
// duyệt" (mặc định, như cũ), mũi tên mở menu "Thêm bước duyệt" / "Thêm bước DLC". Hai loại bước không nối với nhau trong một
// sơ đồ (trộn ⇒ lỗi KIND_MIX, không lưu được). dlc-step-library: "Thêm bước DLC" là menu con chọn BƯỚC MẪU của thư viện
// (tên + việc) hoặc "Bước trống".
import { PROCESS_STAGES_MAX } from "@ai/contracts/hub-admin";
import { Bell, ChevronDown, Clock, LayoutTemplate, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

type Template = { id: string; name: string; action: string };
type Props = {
  count: number;
  /** Bước DLC mẫu của thư viện (rỗng / vắng ⇒ menu con chỉ còn "Bước trống"). */
  templates?: readonly Template[];
  onAdd: () => void;
  /** `id` = bước mẫu; vắng ⇒ bước DLC trống. */
  onAddDlc: (id?: string) => void;
  /** CR-121 D-6b · thêm bước Thông báo / Chờ tới. */
  onAddSlot: (kind: "notify" | "wait_until") => void;
  onArrange: () => void;
};

function DlcSubMenu({ templates = [], onAddDlc }: Pick<Props, "templates" | "onAddDlc">) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.canvas.${k}`);
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>{f("addDlcStep")}</DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="max-h-80 overflow-y-auto">
        <DropdownMenuLabel>{f("dlcLibrary")}</DropdownMenuLabel>
        {templates.length === 0 ? (
          <DropdownMenuItem disabled>{f("dlcLibraryEmpty")}</DropdownMenuItem>
        ) : (
          templates.map((x) => (
            <DropdownMenuItem key={x.id} onSelect={() => onAddDlc(x.id)}>
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{x.name}</span>
                <span className="text-caption text-muted-foreground">
                  {t(`process.admin.library.dlc.action.${x.action}`, { defaultValue: x.action })}
                </span>
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => onAddDlc()}>{f("dlcBlank")}</DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function SlotCanvasToolbar({
  count,
  templates,
  onAdd,
  onAddDlc,
  onAddSlot,
  onArrange,
}: Props) {
  const { t } = useTranslation();
  const full = count >= PROCESS_STAGES_MAX;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="rounded-r-none"
          disabled={full}
          onClick={onAdd}
        >
          <Plus aria-hidden className="size-4" />
          {t("process.admin.library.canvas.addStep")}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="-ml-px rounded-l-none px-2"
              disabled={full}
              aria-label={t("process.admin.library.canvas.addMenu")}
            >
              <ChevronDown aria-hidden className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            <DropdownMenuItem onSelect={onAdd}>
              {t("process.admin.library.canvas.addStep")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddSlot("notify")}>
              <Bell aria-hidden className="size-4" />
              {t("process.admin.library.canvas.addNotify")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => onAddSlot("wait_until")}>
              <Clock aria-hidden className="size-4" />
              {t("process.admin.library.canvas.addWait")}
            </DropdownMenuItem>
            <DlcSubMenu templates={templates} onAddDlc={onAddDlc} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onArrange}>
        <LayoutTemplate aria-hidden className="size-4" />
        {t("process.admin.canvas.toolbar.arrange")}
      </Button>
    </div>
  );
}
