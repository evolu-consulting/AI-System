// esign-flow · trường của bước "Ký số" (bước cuối luồng duyệt): người ký phía công ty (người phụ trách / trưởng phòng / người cụ thể),
// đối tác ký (email lấy từ liên hệ đối tác của HĐ), thứ tự ký, nhà cung cấp (mặc định công ty), hạn/nhắc/chuyển cấp như bước duyệt.
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { esignSettingsKey, fetchEsignSettings } from "~/features/contract-esign/api";
import type { FlowEsignStep } from "../api-flow";
import { DUE_MIN, REMIND_MAX, REMIND_MIN } from "../lib/flow-state";
import { FIELD } from "./controls";

type Opt = { id: string; name: string };
type Props = {
  step: FlowEsignStep;
  depts: Opt[];
  people: Opt[];
  err: (field: string) => string | undefined;
  onPatch: (p: Partial<FlowEsignStep>) => void;
};

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string | undefined;
  children: ReactNode;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: ô nhập là `children` (nhãn bao ngoài)
    <label className="flex flex-col gap-1">
      <span className="text-caption text-dim">{label}</span>
      {children}
      {error && (
        <span role="alert" className="text-caption text-late">
          {error}
        </span>
      )}
    </label>
  );
}

const Options = ({ items }: { items: Opt[] }) =>
  items.map((d) => (
    <option key={d.id} value={d.id}>
      {d.name}
    </option>
  ));

export function FlowEsignFields({ step, depts, people, err, onPatch }: Props) {
  const { t } = useTranslation();
  const f = (k: string, o?: Record<string, string | number>) => t(`contracts.flow.esign.${k}`, o);
  const ps = useQuery({ queryKey: esignSettingsKey, queryFn: fetchEsignSettings, retry: false });
  const providers = (ps.data?.providers ?? []).filter((p) => p.available);
  const c = step.company_signer;
  const signer = (p: Partial<FlowEsignStep["company_signer"]>) =>
    onPatch({ company_signer: { ...c, ...p } });
  return (
    <div className="grid grid-cols-2 gap-3 max-md:grid-cols-1" data-testid="flow-esign-fields">
      <Field label={t("contracts.flow.name")} error={err("name")}>
        <input
          className={FIELD}
          value={step.name}
          onChange={(e) => onPatch({ name: e.target.value })}
        />
      </Field>
      <Field label={f("signer")}>
        <select
          className={FIELD}
          aria-label={f("signer")}
          value={c.mode}
          onChange={(e) => onPatch({ company_signer: { mode: e.target.value as typeof c.mode } })}
        >
          <option value="owner">{f("mode.owner")}</option>
          <option value="dept_head">{f("mode.dept_head")}</option>
          <option value="user">{f("mode.user")}</option>
        </select>
      </Field>
      {c.mode === "dept_head" && (
        <Field label={f("signerDept")} error={err("company_signer")}>
          <select
            className={FIELD}
            aria-label={f("signerDept")}
            value={c.department_group_id ?? ""}
            onChange={(e) => signer({ department_group_id: e.target.value || null })}
          >
            <option value="">{t("contracts.flow.pick")}</option>
            <Options items={depts} />
          </select>
        </Field>
      )}
      {c.mode === "user" && (
        <Field label={f("signerUser")} error={err("company_signer")}>
          <select
            className={FIELD}
            aria-label={f("signerUser")}
            value={c.user_id ?? ""}
            onChange={(e) => signer({ user_id: e.target.value || null })}
          >
            <option value="">{t("contracts.flow.pick")}</option>
            <Options items={people} />
          </select>
        </Field>
      )}
      <Field label={f("order")}>
        <select
          className={FIELD}
          aria-label={f("order")}
          value={step.order}
          disabled={!step.partner_signs}
          onChange={(e) => onPatch({ order: e.target.value as FlowEsignStep["order"] })}
        >
          <option value="company_first">{f("companyFirst")}</option>
          <option value="partner_first">{f("partnerFirst")}</option>
        </select>
      </Field>
      <Field label={f("provider")}>
        <select
          className={FIELD}
          aria-label={f("provider")}
          value={step.provider ?? ""}
          onChange={(e) => onPatch({ provider: e.target.value || null })}
        >
          <option value="">{f("providerDefault")}</option>
          {providers.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label={t("contracts.flow.dueH")} error={err("due_h")}>
        <input
          type="number"
          min={DUE_MIN}
          className={FIELD}
          value={step.due_h}
          onChange={(e) => onPatch({ due_h: Number(e.target.value) })}
        />
      </Field>
      <Field
        label={t("contracts.flow.remindH", { min: REMIND_MIN, max: REMIND_MAX })}
        error={err("remind_every_h")}
      >
        <input
          type="number"
          className={FIELD}
          placeholder={t("contracts.flow.none")}
          value={step.remind_every_h ?? ""}
          onChange={(e) =>
            onPatch({ remind_every_h: e.target.value === "" ? null : Number(e.target.value) })
          }
        />
      </Field>
      <Field label={t("contracts.flow.escalate")}>
        <select
          className={FIELD}
          value={step.escalate_group_id ?? ""}
          onChange={(e) => onPatch({ escalate_group_id: e.target.value || null })}
        >
          <option value="">{t("contracts.flow.none")}</option>
          <Options items={depts} />
        </select>
      </Field>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={step.partner_signs}
          onChange={(e) => onPatch({ partner_signs: e.target.checked })}
        />
        {f("partnerSigns")}
      </label>
      <p className="col-span-2 text-caption text-dim max-md:col-span-1">{f("info")}</p>
    </div>
  );
}
