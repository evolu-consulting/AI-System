// CR-122 · U2d · FLOW2-FR-26: kiểm nối — MỘT dòng "N chỗ nối thiếu dữ liệu"; bấm ⇒ nhảy tới cạnh vàng đầu tiên trên canvas.
// Gợi ý cầu nối (AI), xem trước node mờ, Nhận/Bỏ nằm ngay trên canvas (`canvas/BridgeNode`, `hooks/use-bridge`).
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { EdgeGroup } from "../../lib/palette-node";

type Props = {
  groups: readonly EdgeGroup[];
  /** Chọn node phía sau cạnh vàng đầu tiên (canvas pan tới đó). */
  onSelect: (uid: string) => void;
};

export function BridgeIssues({ groups, onSelect }: Props) {
  const { t } = useTranslation();
  const first = groups[0];
  if (!first) return null;
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-md border border-warning bg-warning-bg px-3 py-2 text-left text-caption text-warning hover:underline"
      data-testid="flow-bridge"
      onClick={() => onSelect(first.to)}
    >
      <AlertTriangle aria-hidden className="size-4 shrink-0" />
      {t("process.admin.flow.bridge.summary", { n: groups.length })}
    </button>
  );
}
