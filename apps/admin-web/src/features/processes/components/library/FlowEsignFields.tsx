// CR-105 · L3: trường của bước "Ký số" (bước cuối Form). Chuyển từ contracts-web `FlowEsignFields`; phòng ban theo mã; nhà cung cấp
// nhập khoá (khe hở: danh mục nhà cung cấp ký số theo tenant không có ở admin-web); "người cụ thể" chỉ hiện khi bước đã có (giữ nguyên).
import { useTranslation } from "react-i18next";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import type { LibEsignStep } from "../../lib/flow-form";
import { SelectField, TextField } from "../editor/Fields";
import type { StepFieldProps } from "./flow-step-props";
import { GroupKeyField } from "./GroupKeyField";

type P = StepFieldProps<LibEsignStep>;

export function FlowEsignFields({ id, step, groups, err, onPatch }: P) {
  const { t } = useTranslation();
  const f = (k: string) => t(`process.admin.library.form.esign.${k}`);
  const c = step.company_signer;
  const modes = [
    { value: "owner", label: f("mode.owner") },
    { value: "dept_head", label: f("mode.dept_head") },
    ...(c.mode === "user" ? [{ value: "user", label: f("mode.user") }] : []),
  ];
  return (
    <div className="grid gap-3 md:grid-cols-2" data-testid="flow-esign-fields">
      <TextField
        id={`${id}-name`}
        label={t("process.admin.library.form.name")}
        value={step.name}
        error={err("name")}
        onChange={(name) => onPatch({ name })}
      />
      <SelectField
        id={`${id}-signer`}
        label={f("signer")}
        value={c.mode}
        options={modes}
        onChange={(m) => onPatch({ company_signer: { mode: m as typeof c.mode } })}
      />
      {c.mode === "dept_head" ? (
        <GroupKeyField
          id={`${id}-signer-dept`}
          label={f("signerDept")}
          value={c.department_group_key ?? null}
          options={groups}
          error={err("company_signer")}
          onChange={(v) => onPatch({ company_signer: { ...c, department_group_key: v } })}
        />
      ) : null}
      <SelectField
        id={`${id}-order`}
        label={f("order")}
        value={step.order}
        disabled={!step.partner_signs}
        options={[
          { value: "company_first", label: f("companyFirst") },
          { value: "partner_first", label: f("partnerFirst") },
        ]}
        onChange={(order) => onPatch({ order: order as LibEsignStep["order"] })}
      />
      <TextField
        id={`${id}-provider`}
        label={f("provider")}
        placeholder={f("providerDefault")}
        mono
        value={step.provider ?? ""}
        onChange={(v) => onPatch({ provider: v.trim() === "" ? null : v.trim() })}
      />
      <TextField
        id={`${id}-due`}
        label={t("process.admin.library.form.dueH")}
        type="number"
        value={String(step.due_h)}
        error={err("due_h")}
        onChange={(v) => onPatch({ due_h: Number(v) })}
      />
      <TextField
        id={`${id}-remind`}
        label={t("process.admin.library.form.remindH")}
        type="number"
        value={step.remind_every_h === null ? "" : String(step.remind_every_h)}
        error={err("remind_every_h")}
        placeholder={t("process.admin.library.form.none")}
        onChange={(v) => onPatch({ remind_every_h: v === "" ? null : Number(v) })}
      />
      <GroupKeyField
        id={`${id}-escalate`}
        label={t("process.admin.library.form.escalate")}
        value={step.escalate_group_key}
        options={groups}
        onChange={(v) => onPatch({ escalate_group_key: v })}
      />
      <Label className="flex items-center gap-2 font-normal">
        <Checkbox
          checked={step.partner_signs}
          onCheckedChange={(v) => onPatch({ partner_signs: v === true })}
        />
        {f("partnerSigns")}
      </Label>
      <p className="text-caption text-muted-foreground md:col-span-2">{f("info")}</p>
    </div>
  );
}
