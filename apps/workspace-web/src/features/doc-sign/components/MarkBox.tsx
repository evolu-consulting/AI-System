// CR-181 · chữ ký đặt tự do: kéo, 4 góc đổi cỡ giữ tỉ lệ, nhãn «Trang n» / «Giáp lai …», bàn phím.
import type { TFunction } from "i18next";
import { useTranslation } from "react-i18next";
import type { SignItem } from "../lib/sign-items";
import { BoxFrame, type BoxFrameProps } from "./BoxFrame";

type Shared = Omit<
  BoxFrameProps,
  "ariaLabel" | "tag" | "toneClass" | "editable" | "aspect" | "children"
>;

export const markLabel = (t: TFunction, item: SignItem) =>
  item.parts.length > 1
    ? t("contracts.docsign.seamLabel", {
        count: item.parts.length,
        pages: item.parts.map((x) => x.page + 1).join(", "),
      })
    : t("contracts.docsign.pageLabel", { n: (item.parts[0]?.page ?? 0) + 1 });

export function MarkBox({ item, ...p }: Shared & { item: SignItem }) {
  const { t } = useTranslation();
  const label = markLabel(t, item);
  return (
    <BoxFrame
      {...p}
      editable={item.status === "editable"}
      aspect={item.aspect}
      ariaLabel={t("contracts.docsign.markAria", { label })}
      tag={label}
      toneClass="border-primary bg-primary/5"
      testId="sign-mark"
    >
      {item.imageUrl && (
        <img src={item.imageUrl} alt="" draggable={false} className="size-full object-contain" />
      )}
    </BoxFrame>
  );
}
