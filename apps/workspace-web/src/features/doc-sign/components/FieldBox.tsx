// CR-181 · ô chỗ ký. Soạn (prep): kéo được. Ký (sign): ô của mình = nút «Bấm để ký» nhấp nháy; ô người khác = «Chờ <người> ký».
import { Button } from "@ai/web-kit/ui/kit/button";
import { useTranslation } from "react-i18next";
import type { SignItem } from "../lib/sign-items";
import { BoxFrame, type BoxFrameProps } from "./BoxFrame";
import { markLabel } from "./MarkBox";

type Shared = Omit<
  BoxFrameProps,
  "ariaLabel" | "tag" | "toneClass" | "editable" | "aspect" | "children"
>;

export function FieldBox({
  item,
  mode,
  onFieldClick,
  ...p
}: Shared & { item: SignItem; mode: "prep" | "sign"; onFieldClick?: () => void }) {
  const { t } = useTranslation();
  const name = item.person ?? "";
  const tone =
    item.side === "B" ? "border-orange-500 bg-orange-500/10" : "border-violet-500 bg-violet-500/10";
  return (
    <BoxFrame
      {...p}
      editable={mode === "prep" && item.status === "editable"}
      aspect={item.aspect}
      ariaLabel={t("contracts.docsign.fieldAria", { name })}
      tag={name || markLabel(t, item)}
      toneClass={tone}
      testId="sign-field"
    >
      {mode === "sign" && item.status === "mine" && (
        <Button
          size="sm"
          className="absolute inset-1 h-auto animate-pulse"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onFieldClick}
        >
          {t("contracts.docsign.clickToSign")}
        </Button>
      )}
      {mode === "sign" && item.status === "other" && (
        <span className="flex size-full items-center justify-center p-1 text-center text-xs text-muted-foreground">
          {t("contracts.docsign.waiting", { name })}
        </span>
      )}
    </BoxFrame>
  );
}
