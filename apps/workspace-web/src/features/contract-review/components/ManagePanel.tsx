// CR-127 · U5 · M9/M10: "Phụ trách ▾" nằm trên dòng thông tin đầu trang (thay khối "Quản lý hợp đồng · Giao cho"); hoa hồng % của HĐ Giới thiệu và
// "AI đọc lại từ đầu" chỉ ở DRAFT. Chỉ vai có quyền ghi thấy ô sửa.
import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import {
  useAssignees,
  useAssignOwner,
  useEditCommission,
  useMemberNames,
} from "../hooks/use-manage";
import { parsePct } from "../lib/manage";
import { ReextractButton } from "./ReextractButton";

/** "Phụ trách ▾" — chọn người phụ trách (chữ đọc khi không có quyền ghi). */
export function OwnerRow({ c, write }: { c: ContractDetail; write: boolean }) {
  const { t } = useTranslation();
  const nameOf = useMemberNames();
  const people = useAssignees(write);
  const assign = useAssignOwner(c.id);
  const cur = c.owner_user_id;
  const label = cur
    ? (nameOf(cur) ?? t("contracts.gapa1.owner.unknown"))
    : t("contracts.gapa1.owner.none");
  const opts = people.data?.items ?? [];
  return (
    <span
      className="inline-flex max-w-full flex-wrap items-center gap-2 max-sm:pr-4"
      data-testid="owner-row"
    >
      <span className="text-[13px] text-dim">{t("contracts.u5.owner.label")}</span>
      {write ? (
        <select
          className="input w-auto max-w-full min-w-0 [field-sizing:content]"
          aria-label={t("contracts.u5.owner.label")}
          data-testid="owner-select"
          value={cur ?? ""}
          disabled={assign.isPending || people.isPending}
          onChange={(e) => assign.mutate(e.target.value || null)}
        >
          <option value="">{t("contracts.gapa1.owner.none")}</option>
          {cur && !opts.some((o) => o.id === cur) && <option value={cur}>{label}</option>}
          {opts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      ) : (
        <span className="font-medium">{label}</span>
      )}
    </span>
  );
}

function CommissionRow({ c }: { c: ContractDetail }) {
  const { t } = useTranslation();
  const [text, setText] = useState(c.commission_pct === null ? "" : String(c.commission_pct));
  const save = useEditCommission(c.id, c.version);
  const p = parsePct(text);
  const same = p.ok && p.value === c.commission_pct;
  return (
    <div className="flex flex-wrap items-center gap-3" data-testid="commission-row">
      <label htmlFor="commission-pct" className="text-[13px] text-dim">
        {t("contracts.gapa1.commission.label")}
      </label>
      <input
        id="commission-pct"
        className="input w-24"
        inputMode="decimal"
        value={text}
        aria-invalid={!p.ok}
        onChange={(e) => setText(e.target.value)}
      />
      <button
        type="button"
        className="btn btn-primary btn-sm"
        data-testid="commission-save"
        disabled={!p.ok || same || save.isPending}
        onClick={() => p.ok && save.mutate(p.value)}
      >
        {t("contracts.common.save")}
      </button>
      {!p.ok && (
        <span className="text-sm text-late">{t("contracts.gapa1.commission.invalid")}</span>
      )}
      {c.commission_fixed !== null && (
        <span className="text-sm text-dim">{t("contracts.gapa1.commission.fixedNote")}</span>
      )}
    </div>
  );
}

export function ManagePanel({ c, write }: { c: ContractDetail; write: boolean }) {
  const draft = c.status === "draft";
  const showCommission = write && c.deal === "referral" && draft && c.extract_state === "ready";
  const showReextract = write && draft && c.has_source && c.extract_state !== "reading";
  if (!showCommission && !showReextract) return null;
  return (
    <Panel className="mb-4 flex flex-col gap-3 px-5 py-4">
      {showReextract && (
        <div className="flex justify-end">
          <ReextractButton id={c.id} />
        </div>
      )}
      {showCommission && <CommissionRow key={`${c.id}:${c.version}`} c={c} />}
    </Panel>
  );
}
