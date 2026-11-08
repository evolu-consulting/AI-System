// CR-125 · cr125-form-step-card · giá trị form đã gửi, CHỈ ĐỌC (bước form đã xong, các bước sau và lịch sử thẻ). Nhãn/giá trị là TEXT
// (React escape). Tiền ⇒ «1.000.000 đ», ngày ⇒ dd/mm/yyyy, ô tick ⇒ Có/Không, chọn ⇒ nhãn lựa chọn, tệp ⇒ tên tệp.
import type { FlowFormField, FlowFormValues } from "@ai/contracts/flow";
import { useTranslation } from "react-i18next";
import { FileName } from "~/components/shared/FileUploadField";

const dmy = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
};

function Value({ f, v }: { f: FlowFormField; v: NonNullable<FlowFormValues[string]> }) {
  const { t } = useTranslation();
  switch (f.type) {
    case "file_ref":
      return typeof v === "string" ? <FileName id={v} /> : null;
    case "checkbox":
      return <>{t(v === true ? "contracts.flowPanel.form.yes" : "contracts.flowPanel.form.no")}</>;
    case "money":
      return <>{`${Number(v).toLocaleString("vi-VN")} ₫`}</>;
    case "date":
      return <>{dmy(String(v))}</>;
    case "select":
      return <>{f.options.find((o) => o.value === v)?.label ?? String(v)}</>;
    default:
      return <span className="whitespace-pre-line">{String(v)}</span>;
  }
}

export function FormValuesView({
  fields,
  values,
}: {
  fields: readonly FlowFormField[];
  values: FlowFormValues;
}) {
  const rows = fields.filter((f) => values[f.key] !== undefined && values[f.key] !== null);
  if (rows.length === 0) return null;
  return (
    <dl
      data-flow="form-values"
      className="mt-1 grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-sm"
    >
      {rows.map((f) => (
        <div key={f.key} data-flow-value={f.key} className="contents">
          <dt className="text-caption text-dim">{f.label}</dt>
          <dd className="m-0 min-w-0 break-words">
            <Value f={f} v={values[f.key] as NonNullable<FlowFormValues[string]>} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
