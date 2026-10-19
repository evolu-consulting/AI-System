// PK-FR-10 · TF5 · khoang trợ lý — nạp lazy (chunk "assistant"), rỗng tới HD6 (S15 Panel + thẻ đề xuất).
import { useTranslation } from "react-i18next";
import { IconRobot } from "~/components/icons";

export default function AssistantPanel({
  onClose,
  closeLabel,
}: {
  onClose: () => void;
  closeLabel?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-[58px] shrink-0 items-center gap-2 border-b border-rule px-4">
        <IconRobot className="text-act" />
        <p className="text-body font-semibold">{t("contracts.shell.assistant")}</p>
        {closeLabel && (
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md px-2 py-1 text-label text-dim hover:bg-sunk"
          >
            {closeLabel}
          </button>
        )}
      </div>
      <p className="p-4 text-label text-dim">{t("contracts.shell.assistantSoon")}</p>
    </div>
  );
}
