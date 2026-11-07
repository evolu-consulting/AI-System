// CR-125 · x9 · chọn hướng bố cục sơ đồ: Ngang (trái → phải) / Dọc (trên → dưới). Lưu trong `ui.dir` của flow (cùng chỗ vị trí tay), đổi hướng = một bước hoàn tác.
import type { LayoutDir } from "@ai/contracts/hub-admin";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

const OPTIONS = [
  { dir: "RIGHT", key: "horizontal", testid: "flow-layout-right" },
  { dir: "DOWN", key: "vertical", testid: "flow-layout-down" },
] as const;

export function LayoutDirControl(p: { dir: LayoutDir; onChange: (d: LayoutDir) => void }) {
  const { t } = useTranslation();
  return (
    <fieldset
      aria-label={t("process.admin.canvas.toolbar.layout")}
      className="m-0 inline-flex items-center gap-0.5 rounded-md border border-border p-0.5"
      data-testid="flow-layout-dir"
    >
      {OPTIONS.map((o) => (
        <Button
          key={o.dir}
          type="button"
          size="sm"
          variant={p.dir === o.dir ? "secondary" : "ghost"}
          aria-pressed={p.dir === o.dir}
          data-testid={o.testid}
          onClick={() => p.dir !== o.dir && p.onChange(o.dir)}
        >
          {t(`process.admin.canvas.toolbar.${o.key}`)}
        </Button>
      ))}
    </fieldset>
  );
}
