// ADM-FR-01 · `t` nới kiểu cho key động (key lấy từ bảng mã lỗi/menu). Key tĩnh nên dùng `useTranslation().t`.
import { useTranslation } from "react-i18next";
import type { Translate } from "./format";

export function useTr(): Translate {
  const { t } = useTranslation();
  return t as unknown as Translate;
}
