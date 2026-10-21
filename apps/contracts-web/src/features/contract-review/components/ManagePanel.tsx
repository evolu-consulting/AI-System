// gap-a1 #7 · #16 · #5: khối "Quản lý" trên trang chi tiết — "Giao cho" (người phụ trách; chỉ thành viên có quyền xem gói), hoa hồng %
// của HĐ Giới thiệu (sửa được sau khi lưu), "AI đọc lại từ đầu" khi HĐ còn chờ xác nhận. Chỉ vai có quyền ghi thấy ô sửa.
import type { ContractDetail } from "@ai/contracts";
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

const READY = (s: string) => s !== "extracting" && s !== "extract_failed";

function OwnerRow({ c, write }: { c: ContractDetail; write: boolean }) {
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
    <div className="flex flex-wrap items-center gap-3" data-testid="owner-row">
      <span className="text-[13px] text-dim">{t("contracts.gapa1.owner.label")}</span>
      {write ? (
        <select
          className="input w-auto min-w-[200px]"
          aria-label={t("contracts.gapa1.owner.label")}
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
    </div>
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
  const { t } = useTranslation();
  if (c.status === "extracting") return null;
  const showCommission = write && c.deal === "referral" && READY(c.status);
  const showReextract = write && c.status === "needs_review" && c.has_source;
  return (
    <Panel className="mb-4 flex flex-col gap-3 px-5 py-4">
      <h2 className="text-[15px] font-semibold">{t("contracts.gapa1.manage")}</h2>
      <OwnerRow c={c} write={write} />
      {showCommission && <CommissionRow key={`${c.id}:${c.version}`} c={c} />}
      {showReextract && (
        <div>
          <ReextractButton id={c.id} />
        </div>
      )}
    </Panel>
  );
}
