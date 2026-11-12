// PK-FR-10 · TF5 · khoang ở điện thoại: sheet 85 dvh phủ từ dưới lên (trợ lý + tab Tin nhắn, hoặc góp ý).
import { useTranslation } from "react-i18next";
import type { DockMode, DockPanel } from "../hooks/use-dock";
import { DockBody } from "./AssistantDock";

export function DockSheet({
  mode,
  panel,
  name,
  onClose,
}: {
  mode: DockMode;
  panel: DockPanel;
  name: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex flex-col lg:hidden">
      <button
        type="button"
        tabIndex={-1}
        aria-label={t("contracts.common.close")}
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div
        role="dialog"
        aria-label={name}
        className="relative mt-auto h-[85dvh] overflow-hidden rounded-t-2xl bg-panel"
      >
        <DockBody
          mode={mode}
          panel={panel}
          onClose={onClose}
          closeLabel={t("contracts.common.close")}
        />
      </div>
    </div>
  );
}
