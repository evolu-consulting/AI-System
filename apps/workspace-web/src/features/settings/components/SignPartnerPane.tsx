// CR-138b · Cài đặt › «Ký & đối tác»: các khối KHÔNG phải bước quy trình nhưng bước quy trình cần (Ký số, Người ký HĐ + tự trả việc, Đối tác xác nhận).
// Mỗi khối có MỘT câu nói nó tác động bước nào của quy trình. Tab chỉ hiện với chủ sở hữu (mọi khối ở đây chỉ quản trị sửa — luật CR-138 ẩn tab chỉ đọc).
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { EsignSetting } from "~/features/contract-esign/components/EsignSetting";
import { ReceiveSettings } from "~/features/partner-inbox/components/ReceiveSettings";
import { FlowWorkSettings } from "./FlowWorkSettings";

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
      <Block id="work" note={n("work")}>
        <FlowWorkSettings />
      </Block>
      <Block id="partner" note={n("partner")}>
        <ReceiveSettings owner={owner} />
      </Block>
    </div>
  );
}
