// CR-181 · menu chuột phải / chạm giữ tại một điểm: «Thêm chữ ký của tôi ở đây» / «Thêm chỗ ký cho <người>».
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { useTranslation } from "react-i18next";
import type { SignTray } from "./types";

export function StageMenu(p: {
  at: { x: number; y: number } | null;
  trays: SignTray[];
  /** Điểm chuột phải được chụp lại lúc chọn, vì menu đóng ngay sau đó. */
  onPick: (tray: SignTray, at: { x: number; y: number }) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  if (!p.at) return null;
  return (
    <DropdownMenu open onOpenChange={(o) => !o && p.onClose()} modal={false}>
      <DropdownMenuTrigger asChild>
        <span
          aria-hidden="true"
          className="absolute size-px"
          style={{ left: p.at.x, top: p.at.y }}
        />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        {p.trays.map((tr) => (
          <DropdownMenuItem key={tr.id} onSelect={() => p.at && p.onPick(tr, p.at)}>
            {tr.type === "mark"
              ? t("contracts.docsign.ctxAddMine")
              : t("contracts.docsign.ctxAddField", { name: tr.person })}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
