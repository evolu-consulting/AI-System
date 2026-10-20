// V2-F · HD-09 · mockup `renderCDetail`: khối "Thông tin hợp đồng" — cùng lưới ô với form nhập tay (`FieldsGrid`), loại HĐ hiện nhưng KHÓA
// (không đổi sau khi lưu), hoa hồng khóa; ô agent chưa chắc có nhãn + trích dẫn. Ở bước xác nhận Lưu/Hủy nằm trên thanh dính, còn lại có
// nút "Lưu thay đổi" ngay đầu khối.
import type { ContractDetail } from "@ai/contracts";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { DealTiles } from "~/features/contract-form/components/DealTiles";
import { FieldsGrid } from "~/features/contract-form/components/FieldsGrid";
import { badgesOf, LOCKED_AFTER_SAVE } from "~/features/contract-form/lib/detail-form";
import type { FormState, TextKey } from "~/features/contract-form/lib/form-model";

const NONE: ReadonlySet<never> = new Set();

export function InfoPanel({
  c,
  f,
  onSet,
  disabled,
  saveButton,
}: {
  c: ContractDetail;
  f: FormState;
  onSet: (k: TextKey, v: string) => void;
  disabled: boolean;
  /** Nút "Lưu thay đổi" ở đầu khối (vắng ở bước xác nhận: Lưu nằm trên thanh dính). */
  saveButton?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Panel>
      <div className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3.5">
        <h2 className="text-[15px] font-semibold">{t("contracts.cform.infoTitle")}</h2>
        {saveButton && <span className="ml-auto">{saveButton}</span>}
      </div>
      <div className="flex flex-col gap-4 px-5 py-4">
        <DealTiles value={f.deal} onChange={() => undefined} locked />
        <FieldsGrid
          f={f}
          onSet={onSet}
          invalid={NONE}
          cols={2}
          disabled={disabled}
          lockedKeys={LOCKED_AFTER_SAVE}
          badges={badgesOf(c, t("contracts.cform.unsure"))}
        />
      </div>
    </Panel>
  );
}
