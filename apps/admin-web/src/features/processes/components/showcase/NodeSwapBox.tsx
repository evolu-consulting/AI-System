// CR-103 · R4 fnr-showcase: ô "Đổi node" — minh hoạ R3. Hiện danh sách họ/loại node; `canSwap` (R3) sẽ nối vào đây,
// hiện CHƯA có nên chỉ liệt kê và ghi chú họ nào đổi qua lại được.
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { NODE_FAMILIES, swappable } from "../../lib/showcase";

const K = "process.admin.showcase.swap.";

export function NodeSwapBox() {
  const { t } = useTranslation();
  return (
    <div data-testid="showcase-swap" className="space-y-3">
      <p className="text-caption text-muted-foreground">{t(`${K}hint`)}</p>
      <ul className="space-y-2">
        {NODE_FAMILIES.map((f) => (
          <li key={f.family} className="flex flex-wrap items-center gap-2">
            <strong className="min-w-24 text-label font-medium">
              {t(`${K}family.${f.family}`)}
            </strong>
            {f.kinds.map((k) => (
              <Badge key={k} variant="info">
                {k}
              </Badge>
            ))}
            <span className="text-caption text-muted-foreground">
              {swappable(f.family) ? t(`${K}yes`) : t(`${K}no`)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
