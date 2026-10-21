// price-scout · câu lỗi lưu cài đặt dò giá: 403 ⇒ "chỉ quản lý được đổi"; còn lại ⇒ lỗi chung.
import { ApiError } from "@ai/web-kit/http";
import type { TFunction } from "i18next";

export const saveErrorText = (e: unknown, t: TFunction): string =>
  e instanceof ApiError && e.status === 403
    ? t("contracts.scout.forbidden")
    : t("contracts.errors.unknown");
