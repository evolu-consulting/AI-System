// ADM-FR-20 · ADM-BR-06 · công tắc bật/tắt command ở danh sách; workflow tắt → khoá kèm tooltip "Bật workflow {key} trước".
// Khoá bằng `aria-disabled` (không dùng `disabled`) để tooltip vẫn nhận hover/focus và công tắc vẫn dùng được bàn phím để đọc lý do.
import type { CommandListItem } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Props = {
  command: CommandListItem;
  /** Giá trị lạc quan đang chờ server (hoặc `undefined`). */
  optimistic?: boolean;
  onToggle: (c: CommandListItem, enabled: boolean) => void;
};

export function CommandToggle({ command, optimistic, onToggle }: Props) {
  const { t } = useTranslation();
  const locked = !command.workflow.enabled && !command.enabled;
  const checked = optimistic ?? command.enabled;
  const sw = (
    <Switch
      checked={checked}
      aria-label={t("commands.list.toggle.aria", { name: command.name })}
      aria-disabled={locked || undefined}
      data-locked={locked || undefined}
      onCheckedChange={(next) => !locked && onToggle(command, next)}
      className={locked ? "cursor-not-allowed opacity-50" : undefined}
    />
  );
  if (!locked) return sw;
  return (
    <Tooltip>
      <TooltipTrigger asChild>{sw}</TooltipTrigger>
      <TooltipContent>
        {t("commands.list.workflowOff", { key: command.workflow.key })}
      </TooltipContent>
    </Tooltip>
  );
}
