// CR-121 c11/c17 · Q11 · MỘT công tắc Sơ đồ/Danh sách bước cho mọi chỗ xem quy trình (ngăn Công ty › Quy trình, trang chỉ-xem, trình sửa).
// Nút icon, nhãn hiện khi rê chuột/focus (title + aria-label); lựa chọn nhớ qua `useViewMode` (canvas mặc định).
import { List, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import type { ViewMode } from "../lib/view-mode";

const MODES: readonly ViewMode[] = ["canvas", "list"];

export function ViewModeToggle({ mode, set }: { mode: ViewMode; set: (m: ViewMode) => void }) {
  const { t } = useTranslation();
  return (
    <span role="toolbar" aria-label={t("tenants.flows.viewMode")} className="inline-flex gap-1">
      {MODES.map((m) => (
        <Button
          key={m}
          size="sm"
          variant={mode === m ? "secondary" : "ghost"}
          aria-pressed={mode === m}
          title={t(`tenants.flows.view.${m}`)}
          aria-label={t(`tenants.flows.view.${m}`)}
          data-testid={`flows-view-${m}`}
          onClick={() => set(m)}
        >
          {m === "canvas" ? (
            <Network aria-hidden className="size-4" />
          ) : (
            <List aria-hidden className="size-4" />
          )}
        </Button>
      ))}
    </span>
  );
}
