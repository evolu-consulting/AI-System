// CR-126 · ô chọn có tìm kiếm của form (danh sách do máy chủ cấp, vd «Chọn đối tác»: "tên · MST"). MỘT component cho mọi nơi
// vẽ form (FormStep): gõ để lọc (không phân biệt hoa/thường và dấu), chọn trong danh sách; lựa chọn đang chọn luôn còn trong danh sách.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { filterOptions, type SelectOption } from "../lib/form-values";

export function FormSearchSelect({
  id,
  className,
  options,
  value,
  onChange,
}: {
  id: string;
  className: string;
  options: readonly SelectOption[];
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation();
  const [query, setQuery] = useState("");
  const shown = filterOptions(options, query, value);
  // Giá trị điền sẵn nằm ngoài danh sách (vd đối tác đã bị gỡ) vẫn hiện để người dùng thấy và đổi.
  const orphan = value !== "" && !options.some((o) => o.value === value);
  return (
    <div className="space-y-1" data-flow-search-select>
      <input
        type="search"
        className={className}
        aria-label={t("contracts.flowPanel.form.search")}
        placeholder={t("contracts.flowPanel.form.search")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <select
        id={id}
        className={className}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="">{t("contracts.flowPanel.form.choose")}</option>
        {orphan ? <option value={value}>{value}</option> : null}
        {shown.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {query.trim() !== "" && shown.length === 0 ? (
        <p className="text-caption text-dim">{t("contracts.flowPanel.form.noMatch")}</p>
      ) : null}
    </div>
  );
}
