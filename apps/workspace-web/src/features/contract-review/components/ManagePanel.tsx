// CR-127 · U5 · M9/M10: "Phụ trách ▾" nằm trên dòng thông tin đầu trang (thay khối "Quản lý hợp đồng · Giao cho"); hoa hồng % của HĐ Giới thiệu và
// "AI đọc lại từ đầu" chỉ ở DRAFT. Chỉ vai có quyền ghi thấy ô sửa.

import type { ContractDetail } from "@ai/contracts/pack-contracts";
import { Avatar } from "@ai/web-kit/ui/kit/avatar";
import { Button } from "@ai/web-kit/ui/kit/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@ai/web-kit/ui/kit/dropdown-menu";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { usePeopleCards } from "~/features/contract-shared/people";
import { AvatarTip, TouchTip } from "~/shared/ui/AvatarTip";
import { useIsMobile } from "~/shared/ui/use-is-mobile";
import {
  useAssignees,
  useAssignOwner,
  useEditCommission,
  useMemberNames,
} from "../hooks/use-manage";
import { ownerOptions, parsePct } from "../lib/manage";
import { OwnerFace, OwnerPopover } from "./OwnerPopover";
import { ReextractButton } from "./ReextractButton";

/** "Phụ trách" — chỉ avatar (tooltip «Phụ trách: tên»); vai có quyền ghi bấm vào để chọn người (avatar + họ tên + chức vụ). */
export function OwnerRow({ c, write }: { c: ContractDetail; write: boolean }) {
  const { t } = useTranslation();
  const mobile = useIsMobile();
  const nameOf = useMemberNames();
  const people = useAssignees(write);
  const assign = useAssignOwner(c.id);
  const cur = c.owner_user_id;
  const opts = people.data?.items ?? [];
  const cards = usePeopleCards([cur, ...opts.map((o) => o.id)]);
  const label = cur
    ? (nameOf(cur) ?? t("contracts.gapa1.owner.unknown"))
    : t("contracts.gapa1.owner.none");
  const tip = t("contracts.u5.owner.tip", { name: label });
  const face = cur ? (
    <Avatar name={label} src={cards.get(cur)?.avatar} size={32} />
  ) : (
    <span className="text-dim">{label}</span>
  );
  return (
    <span className="inline-flex items-center gap-2" data-testid="owner-row">
      {mobile && cur ? (
        <OwnerPopover
          face={face}
          tip={tip}
          cur={cur}
          name={label}
          write={write}
          busy={assign.isPending || people.isPending}
          options={ownerOptions(cur, label, opts)}
          cards={cards}
          onPick={(id) => assign.mutate(id)}
        />
      ) : write ? (
        <DropdownMenu>
          <TouchTip tip={tip}>
            <DropdownMenuTrigger
              data-testid="owner-select"
              aria-label={tip}
              disabled={assign.isPending || people.isPending}
              className="inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60 max-sm:min-h-11 max-sm:min-w-11 max-sm:justify-center"
            >
              {face}
              <span aria-hidden="true" className="text-dim text-xs">
                ▾
              </span>
            </DropdownMenuTrigger>
          </TouchTip>
          <DropdownMenuContent align="start" className="max-h-72 min-w-56">
            <DropdownMenuItem data-testid="owner-option-none" onSelect={() => assign.mutate(null)}>
              {t("contracts.gapa1.owner.none")}
            </DropdownMenuItem>
            {cur && !opts.some((o) => o.id === cur) && (
              <DropdownMenuItem onSelect={() => undefined}>
                <OwnerFace id={cur} name={label} cards={cards} />
              </DropdownMenuItem>
            )}
            {opts.map((o) => (
              <DropdownMenuItem
                key={o.id}
                data-testid={`owner-option-${o.id}`}
                aria-current={o.id === cur ? "true" : undefined}
                onSelect={() => assign.mutate(o.id)}
              >
                <OwnerFace id={o.id} name={o.name} cards={cards} />
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : cur ? (
        <AvatarTip name={label} src={cards.get(cur)?.avatar} tip={tip} />
      ) : (
        face
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
      <Input
        id="commission-pct"
        className="w-24"
        inputMode="decimal"
        value={text}
        aria-invalid={!p.ok}
        onChange={(e) => setText(e.target.value)}
      />
      <Button
        variant="primary"
        size="sm"
        data-testid="commission-save"
        disabled={!p.ok || same || save.isPending}
        onClick={() => p.ok && save.mutate(p.value)}
      >
        {t("contracts.common.save")}
      </Button>
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
