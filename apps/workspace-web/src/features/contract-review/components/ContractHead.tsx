// CR-127 · U5 · M10: MỘT đầu trang — tên HĐ + chip trạng thái + chip hiệu lực (+ chip tạm khoá) + dòng thông tin + nút theo trạng thái/vai.
// CR-128 (e): CR-135 Q2: DRAFT lần đầu: thanh dính nền nhấn — chỉ [Gửi duyệt] + Thao tác ▾ (Lưu nháp · Huỷ · Xoá) (như form nhập tay). Còn lại: tiêu đề thường + nút đã tính theo `can`.
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
import { type DocKind, DocTypeIcon } from "./DocTypeIcon";
import { TitleEdit } from "./TitleEdit";

type Props = {
  c: ContractDetail;
  title: string;
  /** Dòng thông tin dưới tiêu đề (số HĐ · loại · đối tác · giá trị · Phụ trách ▾). */
  lead: ReactNode;
  sticky: boolean;
  /** CR-135 Q12: đổi tên tại chỗ (chỉ nháp, người sửa được). */
  rename?: { enabled: boolean; onSave: (next: string) => Promise<string | null> };
  /** CR-128 (e): MỘT nút chính + «Thao tác ▾» (HeadActions). */
  actions: ReactNode;
};

function Titled({
  c,
  title,
  rename,
}: {
  c: ContractDetail;
  title: string;
  rename: Props["rename"];
}) {
  const left = daysUntil(c.end_date, new Date().toISOString().slice(0, 10));
  return (
    <span className="flex flex-wrap items-center gap-2" data-testid="head-title">
      <DocTypeIcon kind={(c.doc?.doc_type ?? "contract") as DocKind} />
      <TitleEdit
        value={title}
        editable={rename?.enabled === true}
        onSave={rename?.onSave ?? (async () => null)}
      />
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
  const title = <Titled c={p.c} title={p.title} rename={p.rename} />;
  if (p.sticky)
    return (
      <FormBar accent crumb={crumb} title={title} lead={p.lead} cancel={null} save={p.actions} />
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
