// DOC-ui-gaps · mục 3 DOC-ui-list: hộp chọn loại chứng từ trước khi tải lên — HĐ kinh tế (tuỳ chọn "Thuộc HĐ nguyên tắc") hoặc HĐ nguyên tắc
// (hạn mức tuỳ chọn, cách đặt hàng). Giao dịch nhập tay (không tải tệp). Áp cho cả lô tệp vừa chọn.
// TODO(AI): `ai_read.doc_type_suggest` (gợi ý tô vàng, chọn lại) chỉ có SAU khi AI đọc; cần API đổi loại sau khi đọc + hiển thị ở màn kiểm HĐ.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FramePicker } from "~/features/contract-form/components/FramePicker";
import { cn } from "~/lib/utils";
import {
  EMPTY_DRAFT,
  type MetaDraft,
  toUploadMeta,
  UPLOAD_DOC_TYPES,
  type UploadMeta,
} from "../lib/upload-meta";

export function UploadTypeDialog({
  count,
  onConfirm,
  onCancel,
}: {
  count: number;
  onConfirm: (m: UploadMeta) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [d, setD] = useState<MetaDraft>(EMPTY_DRAFT);
  const [err, setErr] = useState<string | null>(null);
  const [frame, setFrame] = useState<{ id: string; title: string } | null>(null);
  const submit = () => {
    const r = toUploadMeta({ ...d, frameId: frame?.id ?? null });
    if (r.ok) return onConfirm(r.meta);
    setErr(t(`contracts.doclist.upload.err.${r.error}`));
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t("contracts.doclist.upload.title")}
        className="flex w-full max-w-lg flex-col gap-4 rounded-xl border border-rule bg-panel p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">{t("contracts.doclist.upload.title")}</h2>
        <p className="text-sm text-dim">{t("contracts.doclist.upload.files", { count })}</p>
        <div
          role="radiogroup"
          aria-label={t("contracts.doclist.filterLabel")}
          className="flex flex-col gap-2"
        >
          {UPLOAD_DOC_TYPES.map((ty) => (
            <label
              key={ty}
              className={cn(
                "flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2",
                d.docType === ty ? "border-act bg-act-soft" : "border-rule",
              )}
            >
              <input
                type="radio"
                name="upload-doc-type"
                className="mt-1"
                checked={d.docType === ty}
                onChange={() => setD({ ...d, docType: ty })}
              />
              <span>
                <span className="font-medium">{t(`contracts.doclist.upload.type.${ty}`)}</span>
                <span className="block text-[12.5px] text-dim">
                  {t(`contracts.doclist.upload.hint.${ty}`)}
                </span>
              </span>
            </label>
          ))}
        </div>
        {d.docType === "contract" ? (
          <div className="flex flex-col gap-1 text-[13px]">
            <label htmlFor="cf-frame">{t("contracts.doclist.frame")}</label>
            <FramePicker value={frame} onChange={setFrame} />
          </div>
        ) : (
          <div className="flex flex-col gap-3 text-[13px]">
            <div className="flex flex-col gap-1">
              <label htmlFor="up-credit">{t("contracts.doclist.upload.credit")}</label>
              <input
                id="up-credit"
                className="field font-mono"
                inputMode="decimal"
                value={d.creditLimit}
                placeholder={t("contracts.doclist.upload.creditPh")}
                onChange={(e) => setD({ ...d, creditLimit: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label htmlFor="up-terms">{t("contracts.doclist.upload.terms")}</label>
              <textarea
                id="up-terms"
                className="field min-h-[72px]"
                value={d.orderTerms}
                placeholder={t("contracts.doclist.upload.termsPh")}
                onChange={(e) => setD({ ...d, orderTerms: e.target.value })}
              />
            </div>
          </div>
        )}
        {err && (
          <p role="alert" className="text-sm text-late">
            {err}
          </p>
        )}
        <div className="flex justify-end gap-2.5">
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            {t("contracts.common.cancel")}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            data-testid="upload-confirm"
            onClick={submit}
          >
            {t("contracts.doclist.upload.go")}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Chỉ hiện khi có tệp đang chờ chọn loại. */
export function UploadTypeGate({
  files,
  onConfirm,
  onCancel,
}: {
  files: File[] | null;
  onConfirm: (m: UploadMeta) => void;
  onCancel: () => void;
}) {
  return files ? (
    <UploadTypeDialog count={files.length} onConfirm={onConfirm} onCancel={onCancel} />
  ) : null;
}
