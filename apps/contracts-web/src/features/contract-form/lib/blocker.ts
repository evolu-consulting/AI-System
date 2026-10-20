// Chặn lưu của form HĐ (nhập tay + bước xác nhận): số không đọc được / thiếu ô bắt buộc / dòng chưa gắn SP ⇒ câu báo; ổn ⇒ null.
import type { TFunction } from "i18next";
import { PARTNER_ROLE } from "./deal";
import { type FormState, missingRequired, readNumbers, unlinkedLines } from "./form-model";

/** `onChecked` chạy sau khi số đọc được (đánh dấu đã thử lưu); `onMissing` chỉ khi thiếu ô/dòng (kèm câu báo). */
export function blockerMessage(
  form: FormState,
  t: TFunction,
  onChecked: () => void,
  onMissing?: (msg: string) => void,
): string | null {
  const n = readNumbers(form);
  if (n.bad.length) {
    const names = n.bad.map((b) => t(`contracts.cform.bad.${b.key}`, { name: b.name }));
    return t("contracts.cform.badNumbers", { list: names.join(", ") });
  }
  onChecked();
  const role = t(`contracts.cform.partnerRole.${PARTNER_ROLE[form.deal]}`);
  const parts = [
    ...missingRequired(form).map((k) => t(`contracts.cform.required.${k}`, { role })),
    ...unlinkedLines(form).map((i) =>
      t("contracts.cform.lineUnlinked", { name: form.items[i]?.name.trim() }),
    ),
  ];
  if (!parts.length) return null;
  const msg = t("contracts.cform.missing", { list: parts.join(", ") });
  onMissing?.(msg);
  return msg;
}
