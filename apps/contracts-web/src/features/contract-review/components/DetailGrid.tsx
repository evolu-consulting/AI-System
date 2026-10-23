// V2-F · HD-04 · mockup `renderCDetail`: lưới hai cột của trang HĐ — [Thông tin · Sản phẩm] | [Dòng thời gian mốc · Tóm tắt].
// V2-G: bước xác nhận sau AI đọc — Sản phẩm = dòng sửa được kèm gợi ý SP; cột phải hiện mốc AI tìm thấy (giữ/bỏ) thay cho dòng thời gian.
import type { ContractDetail } from "@ai/contracts";
import type { ReactNode } from "react";
import { dealOf } from "~/features/contract-form/lib/deal";
import type { FormState, TextKey } from "~/features/contract-form/lib/form-model";
import { Timeline } from "~/features/contract-milestones/components/Timeline";
import type { useInfoForm } from "../hooks/use-info-form";
import { AiMilestonesPanel } from "./AiMilestonesPanel";
import { InfoPanel } from "./InfoPanel";
import { ProductsPanel } from "./ProductsPanel";
import { ReviewItemsPanel } from "./ReviewItemsPanel";
import { SummaryPanel } from "./SummaryPanel";

/** Trạng thái đã có dòng thời gian mốc (HĐ đã vào theo dõi). */
const TRACKED = new Set(["active", "expiring", "expired", "renewed", "terminated"]);

type Info = ReturnType<typeof useInfoForm>;

export function DetailGrid({
  c,
  f,
  onSet,
  canSave,
  saveButton,
  write,
  partner,
  today,
  info,
  lockedKeys,
}: {
  lockedKeys?: ReadonlySet<TextKey> | undefined;
  c: ContractDetail;
  f: FormState;
  onSet: (k: TextKey, v: string) => void;
  canSave: boolean;
  /** Nút "Lưu thay đổi" ở đầu khối Thông tin (vắng ở bước xác nhận). */
  saveButton: ReactNode;
  write: boolean;
  partner: string;
  today: string;
  info: Info;
}) {
  const confirm = info.confirm && canSave;
  const aiMs = info.confirm && (c.ai?.milestones.length ?? 0) > 0;
  const showTimeline = TRACKED.has(c.status) || c.milestones.length > 0;
  return (
    <div className="grid grid-cols-[1.15fr_1fr] items-start gap-4 max-lg:grid-cols-1">
      <div className="flex min-w-0 flex-col gap-4">
        <InfoPanel
          c={c}
          f={f}
          onSet={onSet}
          disabled={!canSave}
          lockedKeys={lockedKeys}
          saveButton={saveButton}
          confirm={
            confirm
              ? {
                  onDeal: info.setDeal,
                  unsure: info.unsure,
                  dealUnsure: info.dealUnsure,
                  invalid: info.invalid,
                }
              : undefined
          }
        />
        {confirm ? (
          <ReviewItemsPanel
            items={f.items}
            deal={f.deal}
            products={info.products}
            unlinked={info.unlinked}
            onPatch={info.patchLine}
            onAdd={info.addLine}
            onRemove={info.removeLine}
          />
        ) : (
          <ProductsPanel
            items={c.items}
            deal={dealOf(c)}
            contractId={c.id}
            write={write && !c.locked}
          />
        )}
      </div>
      <div className="flex min-w-0 flex-col gap-4">
        {aiMs ? (
          <AiMilestonesPanel
            rows={info.rows}
            form={f}
            today={today}
            disabled={!canSave}
            onChange={info.setRow}
          />
        ) : (
          showTimeline && (
            <Timeline c={c} partner={partner} write={write} locked={c.locked} today={today} />
          )
        )}
        <SummaryPanel
          c={c}
          partner={partner}
          generateFor={
            write && c.has_source && c.status !== "extracting" && !confirm ? c.id : undefined
          }
        />
      </div>
    </div>
  );
}
