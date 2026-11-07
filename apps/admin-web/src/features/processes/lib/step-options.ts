// CR-122 · p22 · mọi ô chọn "tới bước" hiện "Bước N · <tên các giai đoạn trong bước>" (nhiều giai đoạn nối bằng " / "), không chỉ "Bước N".
import { useCallback } from "react";
import { useTranslation } from "react-i18next";

type Named = { step: number; name: string };

/** Tên các giai đoạn đang ở bước `step` (0-based), nối bằng " / "; giai đoạn chưa đặt tên bị bỏ. */
export const stepNames = (all: readonly Named[], step: number): string =>
  all
    .filter((s) => s.step === step)
    .map((s) => s.name.trim())
    .filter((n) => n !== "")
    .join(" / ");

/** `fmt(n, names)`: n đếm từ 1; `names` rỗng ⇒ "Bước n". */
export const stepOptionLabel = (
  all: readonly Named[],
  step: number,
  fmt: (n: number, names: string) => string,
): string => fmt(step + 1, stepNames(all, step));

/** Nhãn lựa chọn bước (nhận số bước 0-based) theo ngôn ngữ hiện tại. */
export function useStepOptionLabel(all: readonly Named[]): (step: number) => string {
  const { t } = useTranslation();
  return useCallback(
    (step: number) =>
      stepOptionLabel(all, step, (n, names) =>
        names
          ? t("process.admin.editor.stepOptNamed", { n, names })
          : t("process.admin.editor.stepOpt", { n }),
      ),
    [all, t],
  );
}
