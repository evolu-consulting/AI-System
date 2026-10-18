// ADM-FR-67 · HUB-FR-143 · P-d1 T11b (mockup A5): ô "Trạng thái" của bảng Tiến độ — chờ hẹn (đồng hồ, tông info) / đang thử lại
// (tông cảnh báo) kèm chữ + icon (không chỉ màu — a11y); trạng thái khác giữ chữ thường.
import type { StageView } from "@ai/contracts/chat";
import { Clock, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { stageLabel } from "../../lib/stage-label";

export function StageStatus({ stage }: { stage: StageView }) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "vi" ? "vi" : "en";
  const label = stageLabel(
    stage,
    (k, o) => t(k, o),
    lang,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
  if (label.tone === "none") return <>{label.text}</>;
  return (
    <Badge variant={label.tone === "info" ? "info" : "warn"}>
      {label.tone === "info" ? <Clock aria-hidden /> : <RotateCw aria-hidden />}
      {label.text}
    </Badge>
  );
}
