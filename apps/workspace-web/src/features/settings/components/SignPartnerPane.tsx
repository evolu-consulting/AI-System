// CR-138b · Cài đặt › «Kết nối» (CR-146): chỉ kết nối cấp công ty — Ký số (nhà cung cấp/công tắc) + trạng thái «Đối tác xác nhận». Ký thế nào, ai ký, ngưỡng: đặt trong từng quy trình.
// Mỗi khối có MỘT câu nói nó tác động bước nào của quy trình. Tab chỉ hiện với chủ sở hữu (mọi khối ở đây chỉ quản trị sửa — luật CR-138 ẩn tab chỉ đọc).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EsignSetting } from "~/features/contract-esign/components/EsignSetting";
import { PartnerConfirmStatus } from "~/features/partner-inbox/components/PartnerConfirmStatus";

function Block({ id, note, children }: { id: string; note: string; children: ReactNode }) {
  return (
    <section data-testid={`sign-block-${id}`} className="mb-6">
      <p className="mb-2 text-caption text-dim" data-testid={`sign-note-${id}`}>
        {note}
      </p>
      {children}
    </section>
  );
}

export function SignPartnerPane({ owner }: { owner: boolean }) {
  const { t } = useTranslation();
  const n = (k: string) => t(`contracts.settings.signPane.${k}`);
  return (
    <div data-testid="sign-partner-pane">
      <Block id="esign" note={n("esign")}>
        <EsignSetting owner={owner} />
      </Block>
      <Block id="partner" note={n("partner")}>
        <PartnerConfirmStatus owner={owner} />
      </Block>
    </div>
  );
}
