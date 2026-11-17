// CR-181 · thanh nổi trên mục đang chọn: sign = «Chép sang mọi trang» + «Xoá»; prep = «Đổi người» + «Xoá».
import { Button } from "@ai/web-kit/ui/kit/button";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { useTranslation } from "react-i18next";

export function FloatBar(p: {
  mode: "prep" | "sign";
  x: number;
  y: number;
  canCopy: boolean;
  onCopyAll: () => void;
  onChangePerson: () => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation();
  const Copy = ICONS.copy;
  const Person = ICONS.person;
  const Remove = ICONS.remove;
  return (
    <div
      role="toolbar"
      data-testid="sign-floatbar"
      className="absolute z-20 flex gap-1 rounded-md border bg-popover p-1 shadow-md"
      style={{ left: p.x, top: Math.max(0, p.y - 52) }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {p.mode === "sign" && p.canCopy && (
        <Button size="sm" variant="outline" onClick={p.onCopyAll}>
          <Copy className="size-4" />
          {t("contracts.docsign.copyAll")}
        </Button>
      )}
      {p.mode === "prep" && (
        <Button size="sm" variant="outline" onClick={p.onChangePerson}>
          <Person className="size-4" />
          {t("contracts.docsign.changePerson")}
        </Button>
      )}
      <Button size="sm" variant="outline" onClick={p.onRemove}>
        <Remove className="size-4" />
        {t("contracts.docsign.remove")}
      </Button>
    </div>
  );
}
