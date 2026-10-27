// DOC-ui-list · R5–R10 · Câu 3, 4: /contracts/new?type=deal[&frame=<id>] — form Giao dịch (nhập tay, file không bắt buộc). Dùng chung khối form HĐ
// (loại Mua/Bán/Giới thiệu, ô thông tin, bảng dòng SP gắn danh mục) với nhãn "Tên giao dịch / Số chứng từ / Ngày giao dịch", thêm Nguồn,
// ô "Đã giao / đã thanh toán ngay", "Thuộc HĐ nguyên tắc". Lưu ⇒ `POST /contracts/deals` ⇒ mở giao dịch; "xác nhận ngay" dừng giữa chừng
// (`settle_error`) ⇒ ở lại báo lý do kèm nút mở giao dịch (giao dịch ĐÃ lưu).
// TODO(DOC-legal): cảnh báo pháp lý ở form — chờ trường API; chưa hiển thị. Ghi chú (note): API tạo giao dịch chưa có trường.
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { type FormEvent, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Tag } from "~/components/shared/tag";
import { DealTiles } from "~/features/contract-form/components/DealTiles";
import { FieldsGrid } from "~/features/contract-form/components/FieldsGrid";
import { FormBar } from "~/features/contract-form/components/FormBar";
import { FramePicker } from "~/features/contract-form/components/FramePicker";
import { ItemTable } from "~/features/contract-form/components/ItemTable";
import { useContractForm } from "~/features/contract-form/hooks/use-contract-form";
import { STOCK_EFFECT } from "~/features/contract-form/lib/deal";
import { DEAL_SOURCES, settleErrorKey } from "~/features/contract-form/lib/deal-form";
import { stockTone } from "~/features/contract-form/lib/stock-label";
import { contractKey, fetchContract } from "~/features/contract-review/api";
import { cn } from "~/lib/utils";

/** `frameId` (`/contracts/new?type=deal&frame=<id>`, từ menu "Thêm HĐ/Giao dịch" của HĐ nguyên tắc): điền sẵn "Thuộc HĐ nguyên tắc". */
export function DealNewPage({ frameId }: { frameId?: string }) {
  const { t } = useTranslation();
  const form = useContractForm("deal", frameId);
  const { f, extra, saved, setExtra } = form;
  const frameTitle = useQuery({
    queryKey: contractKey(frameId ?? ""),
    queryFn: ({ signal }) => fetchContract(frameId ?? "", signal),
    enabled: !!frameId,
    staleTime: 60_000,
  }).data?.title;
  useEffect(() => {
    if (frameTitle)
      setExtra((s) =>
        s.frame && s.frame.id === frameId && !s.frame.title
          ? { ...s, frame: { id: s.frame.id, title: frameTitle } }
          : s,
      );
  }, [frameTitle, frameId, setExtra]);
  const effect = STOCK_EFFECT[f.deal];
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    void form.submit();
  };
  const back = (
    <Link to="/contracts" search={{ type: "deal" }} className="hover:underline">
      {t("contracts.doclist.back")}
    </Link>
  );
  if (saved)
    return (
      <div className="text-base leading-[1.55]" data-testid="deal-saved">
        <FormBar
          crumb={back}
          title={t("contracts.doclist.savedTitle")}
          cancel={null}
          save={
            <Link to="/contracts/$id" params={{ id: saved.id }} className="btn btn-primary">
              {t("contracts.doclist.openDeal")}
            </Link>
          }
        />
        <Panel>
          <div className="flex flex-col gap-3 px-5 py-5">
            {saved.settleError && (
              <p role="alert" data-testid="settle-error" className="text-sm text-late">
                {t("contracts.doclist.settleStopped")}{" "}
                {t(settleErrorKey(saved.settleError), { code: saved.settleError })}
              </p>
            )}
            {saved.attachError && (
              <p role="alert" data-testid="attach-error" className="text-sm text-late">
                {t("contracts.doclist.attachFailed")} {saved.attachError}
              </p>
            )}
          </div>
        </Panel>
      </div>
    );
  return (
    <form onSubmit={onSubmit} noValidate className="text-base leading-[1.55]">
      <FormBar
        crumb={back}
        title={t("contracts.doclist.newDealTitle")}
        cancel={
          <Link to="/contracts" className="btn btn-quiet">
            {t("contracts.common.cancel")}
          </Link>
        }
        save={
          <button type="submit" className="btn btn-primary" disabled={form.busy}>
            {form.busy ? t("contracts.cform.saving") : t("contracts.doclist.save")}
          </button>
        }
      />
      {form.err && (
        <p role="alert" className="mb-3 text-sm text-late">
          {form.err}
        </p>
      )}
      <div className="flex flex-col gap-4">
        <Panel>
          <div className="border-b border-rule-soft px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{t("contracts.doclist.infoTitle")}</h2>
          </div>
          <div className="flex flex-col gap-4 px-5 py-4">
            <DealTiles value={f.deal} onChange={form.setDeal} />
            <FieldsGrid f={f} onSet={form.set} invalid={form.invalid} cols={3} dealMode />
            <div className="grid grid-cols-3 gap-x-4 gap-y-3.5 text-[13px] max-lg:grid-cols-2 max-sm:grid-cols-1">
              <div className="flex flex-col gap-1">
                <label htmlFor="cf-source">
                  {t("contracts.doclist.source")} <span className="text-late">*</span>
                </label>
                <select
                  id="cf-source"
                  className={cn("field", form.sourceMissing && "border-late")}
                  aria-invalid={form.sourceMissing || undefined}
                  value={extra.source}
                  onChange={(e) =>
                    form.setExtra((s) => ({ ...s, source: e.target.value as typeof s.source }))
                  }
                >
                  <option value="">{t("contracts.doclist.sourcePick")}</option>
                  {DEAL_SOURCES.map((s) => (
                    <option key={s} value={s}>
                      {t(`contracts.doclist.sourceName.${s}`)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="col-span-2 flex flex-col gap-1 max-lg:col-span-1">
                <label htmlFor="cf-frame">{t("contracts.doclist.frame")}</label>
                <FramePicker
                  value={extra.frame}
                  onChange={(frame) => form.setExtra((s) => ({ ...s, frame }))}
                  disabled={form.busy}
                />
              </div>
            </div>
            <label className="flex items-start gap-2 text-[14px]" htmlFor="cf-settled">
              <input
                id="cf-settled"
                type="checkbox"
                className="mt-1"
                checked={extra.settledNow}
                onChange={(e) => form.setExtra((s) => ({ ...s, settledNow: e.target.checked }))}
              />
              <span>
                {t("contracts.doclist.settledNow")}
                <span className="block text-[12.5px] text-dim">
                  {t("contracts.doclist.settledNowHint")}
                </span>
              </span>
            </label>
          </div>
        </Panel>
        <Panel>
          <div className="flex items-center gap-3 border-b border-rule-soft px-5 py-3.5">
            <h2 className="text-[15px] font-semibold">{t("contracts.cform.itemsTitle")}</h2>
            <Tag tone={stockTone(effect)}>{t(`contracts.cform.stock.${effect}`)}</Tag>
          </div>
          <ItemTable
            items={f.items}
            deal={f.deal}
            products={form.products}
            unlinked={form.unlinked}
            onPatch={form.patchLine}
            onAdd={form.addLine}
            onRemove={form.removeLine}
          />
        </Panel>
      </div>
    </form>
  );
}
