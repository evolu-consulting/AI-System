// CR-110 low · nội dung hộp xác nhận lưu tab Feature: số lượng + tên thân thiện của MỌI feature sẽ bị thu hồi
// (kể cả tính năng thêm bị gỡ khi đặt app về Tắt). Tên lấy từ registry/i18n qua `featureText`.
import { featureText } from "@/features/features/lib/feature-label";
import type { Translate } from "@/lib/format";
import type { TenantFeature } from "./feature-assign";

export function revokeMessage(
  tr: Translate,
  lang: string,
  revoke: readonly TenantFeature[],
): string {
  const list = revoke.map((f) => featureText(tr, lang, f).name).join(", ");
  return tr("tenants.features.confirmBody", { count: revoke.length, list });
}
