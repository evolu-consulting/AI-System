// CR-182 · R1 · ô «Vai»: chọn lại vai đã có trong quy trình hoặc nhập nhãn vai mới (khoá vai sinh từ nhãn). Trình bày thuần, không gọi API.

import { useTranslation } from "react-i18next";
import { ROLE_LABEL_LIMIT, ROLE_NEW, roleFromLabel, roleKeyOf } from "../../lib/role-pick";
import type { StageRole } from "../../lib/role-types";
import { SelectField, TextField } from "./Fields";

type Props = {
  id: string;
  value: StageRole | undefined;
  /** Vai đã có trong quy trình (chọn lại được). */
  existing: readonly StageRole[];
  readOnly: boolean;
  error?: string | undefined;
  onChange: (r: StageRole) => void;
};

export function RoleField(p: Props) {
  const { t } = useTranslation();
  const v = p.value ?? { key: "", label: "" };
  const picked = p.existing.find((r) => r.key === v.key && r.label === v.label);
  const isNew = !picked;
  const noKey = v.label.trim() !== "" && roleKeyOf(v.label) === "";
  const err = p.error ?? (noKey ? t("process.admin.role.labelInvalid") : undefined);
  return (
    <div className="space-y-2" data-testid="role-field">
      {p.existing.length > 0 ? (
        <SelectField
          id={`${p.id}-role-pick`}
          label={t("process.admin.role.pick")}
          value={picked ? picked.key : ROLE_NEW}
          readOnly={p.readOnly}
          options={[
            ...p.existing.map((r) => ({ value: r.key, label: r.label })),
            { value: ROLE_NEW, label: t("process.admin.role.new") },
          ]}
          onChange={(k) => {
            const r = p.existing.find((x) => x.key === k);
            p.onChange(r ?? { key: "", label: "" });
          }}
        />
      ) : null}
      {isNew ? (
        <TextField
          id={`${p.id}-role-label`}
          label={t("process.admin.role.label")}
          value={v.label}
          readOnly={p.readOnly}
          maxLength={ROLE_LABEL_LIMIT}
          placeholder={t("process.admin.role.labelPh")}
          description={t("process.admin.role.hint")}
          alert
          error={err}
          onChange={(l) => p.onChange(roleFromLabel(l))}
        />
      ) : null}
    </div>
  );
}
