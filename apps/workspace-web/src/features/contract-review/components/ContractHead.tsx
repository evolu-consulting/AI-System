// CR-127 · U5 · M10: MỘT đầu trang — tên HĐ + chip trạng thái + chip hiệu lực (+ chip tạm khoá) + dòng thông tin + nút theo trạng thái/vai.
// CR-128 (e): DRAFT lần đầu: thanh dính Huỷ · Lưu nháp · [nút chính] · Thao tác ▾ (như form nhập tay). Còn lại: tiêu đề thường + nút đã tính theo `can`.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { FormBar } from "~/features/contract-form/components/FormBar";
import {
  ContractLockChip,
  EffectChip,
  StatusChip,
} from "~/features/contract-shared/components/Chips";
import { daysUntil } from "~/features/contract-shared/lib/date";

type Props = {
  c: ContractDetail;
  title: string;
  /** Dòng thông tin dưới tiêu đề (số HĐ · loại · đối tác · giá trị · Phụ trách ▾). */
  lead: ReactNode;
  sticky: boolean;
  /** Huỷ: có sửa ⇒ bỏ sửa; chưa sửa ⇒ về danh sách (luôn làm gì đó). */
  onCancel: () => void;
  /** "Lưu nháp" (thanh dính nháp lần đầu). */
  saveButton: ReactNode;
  /** CR-128 (e): MỘT nút chính + «Thao tác ▾» (HeadActions). */
  actions: ReactNode;
};

function Titled({ c, title }: { c: ContractDetail; title: string }) {
  const left = daysUntil(c.end_date, new Date().toISOString().slice(0, 10));
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="head-title">
      <span>{title}</span>
      <StatusChip status={c.status} />
      {c.effect && c.status === "done" && <EffectChip effect={c.effect} daysLeft={left} />}
      {c.hold && <ContractLockChip reason={c.hold.reason} />}
    </span>
  );
}

export function ContractHead(p: Props) {
  const { t } = useTranslation();
  const crumb = (
    <Link to="/contracts/list" className="hover:underline">
      {t("contracts.review.back")}
    </Link>
  );
  const title = <Titled c={p.c} title={p.title} />;
  if (p.sticky)
    return (
      <FormBar
        crumb={crumb}
        title={title}
        lead={p.lead}
        cancel={
          <>
            <button type="button" className="btn btn-quiet btn-sm" onClick={p.onCancel}>
              {t("contracts.common.cancel")}
            </button>
          </>
        }
        save={
          <>
            {p.saveButton}
            {p.actions}
          </>
        }
      />
    );
  return (
    <FormBar
      sticky={false}
      crumb={crumb}
      title={title}
      lead={p.lead}
      cancel={null}
      save={p.actions}
    />
  );
}
