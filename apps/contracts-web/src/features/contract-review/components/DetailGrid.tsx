// V2-F · HD-04 · mockup `renderCDetail`: lưới hai cột của trang HĐ — [Thông tin · Sản phẩm] | [Dòng thời gian mốc · Tóm tắt].
import type { ContractDetail } from "@ai/contracts";
import type { ReactNode } from "react";
import { dealOf } from "~/features/contract-form/lib/deal";
import type { FormState, TextKey } from "~/features/contract-form/lib/form-model";
import { Timeline } from "~/features/contract-milestones/components/Timeline";
import { InfoPanel } from "./InfoPanel";
import { ProductsPanel } from "./ProductsPanel";
import { SummaryPanel } from "./SummaryPanel";

/** Trạng thái đã có dòng thời gian mốc (HĐ đã vào theo dõi). */
const TRACKED = new Set(["active", "expiring", "expired", "renewed", "terminated"]);

export function DetailGrid({
  c,
  f,
  onSet,
  canSave,
  saveButton,
  write,
  partner,
  today,
}: {
  c: ContractDetail;
  f: FormState;
  onSet: (k: TextKey, v: string) => void;
  canSave: boolean;
  /** Nút "Lưu thay đổi" ở đầu khối Thông tin (vắng ở bước xác nhận). */
  saveButton: ReactNode;
  write: boolean;
  partner: string;
  today: string;
}) {
  const showTimeline = TRACKED.has(c.status) || c.milestones.length > 0;
  return (
    <div className="grid grid-cols-[1.15fr_1fr] items-start gap-4 max-lg:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
        <InfoPanel c={c} f={f} onSet={onSet} disabled={!canSave} saveButton={saveButton} />
        <ProductsPanel items={c.items} deal={dealOf(c)} />
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {showTimeline && <Timeline c={c} partner={partner} write={write} today={today} />}
        <SummaryPanel c={c} partner={partner} />
      </div>
    </div>
  );
}
