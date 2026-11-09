// CR-126 · điền sẵn bước «Chọn đối tác & người nhận» (form trong node «Gửi đối tác xác nhận»): đối tác của HĐ (MST) + email liên hệ đầu tiên
// làm mặc định; lựa chọn = đối tác có MST của công ty (`company_partners`, ≤ 200). Đọc bằng uow gói (RLS gói, người xem); 3 câu cố định.
import { FORM_PREFILL_OPTIONS_MAX, type FormPrefill } from "@ai/contracts/flow";
import type { FormPrefillResolver, PackUow } from "../../kit/public";
import type { PartnerToolRepos } from "./partner-send.tool";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 13 chữ số (chi nhánh) ⇒ dạng `0101234567-001` như ô MST của cấu hình node. */
export const taxDisplay = (digits: string): string =>
  digits.length === 13 ? `${digits.slice(0, 10)}-${digits.slice(10)}` : digits;

export function partnerPrefill(uow: PackUow<PartnerToolRepos>): FormPrefillResolver {
  return (q) =>
    uow.tenant({ tenantId: q.tenantId, userId: q.userId }, async (r): Promise<FormPrefill> => {
      const list = await r.partnerSend.partners(FORM_PREFILL_OPTIONS_MAX);
      const options = list.map((p) => ({
        value: taxDisplay(p.tax),
        label: `${p.name} · ${taxDisplay(p.tax)}`,
      }));
      const field_defaults: FormPrefill["field_defaults"] = {};
      if (q.recordId && UUID.test(q.recordId)) {
        const c = await r.partnerSend.contract(q.recordId);
        const email = (await r.esign.contract(q.recordId))?.partner?.email?.trim();
        if (c?.partnerTax) field_defaults.partner_tax_code = c.partnerTax;
        if (email) field_defaults.partner_email = email;
      }
      return { field_defaults, field_options: { partner_tax_code: options } };
    });
}
