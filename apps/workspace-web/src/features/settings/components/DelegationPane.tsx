// CR-127 · U4 · M14 · BR-31…34 · CR-184 · «Uỷ quyền khi vắng» viết thành MỘT câu: «[Tôi ▾] vắng từ [ngày] đến hết [ngày] giao việc [Duyệt] [Ký hợp đồng] …
// cho [Chọn người ▾] [Lưu uỷ quyền]». Ô «Người vắng» chỉ hiện với quản trị công ty (người khác bắt đầu bằng «Tôi vắng từ…»).
// «Đang uỷ quyền» (hết hạn tự ẩn) + «Lịch sử uỷ quyền» (thu gọn, tải dần) ở `DelegationHistory`.
import type { Delegation, DelegationKind } from "@ai/contracts/chat";
import { DELEGATION_KINDS } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { Button } from "@ai/web-kit/ui/kit/button";
import { PersonAvatar } from "@ai/web-kit/ui/kit/person-avatar";
import { TouchTip } from "@ai/web-kit/ui/kit/touch-tip";
import { toast } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { usePeopleCards } from "~/features/contract-shared/people";
import { fetchMembersPage } from "~/features/contracts-list/api";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
import { PersonPick } from "~/shared/ui/PersonPick";
import { SettingsGroup } from "~/shared/ui/settings-layout";
import {
  createDelegation,
  delegationKeys,
  fetchEsignEligible,
  fetchMyDelegations,
  revokeDelegation,
} from "../api-delegation";
import {
  activeDelegations,
  type DelegationForm,
  delegationBody,
  delegationIssue,
  EMPTY_DELEGATION,
  toggleKind,
  withoutEsign,
} from "../lib/delegation";
import { DelegationHistory } from "./DelegationHistory";

const errText = (e: unknown, t: (k: string) => string): string => {
  const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
  return k ? t(k) : t("contracts.errors.unknown");
};
export const dayText = (iso: string, endOfRange = false): string =>
  new Date(Date.parse(iso) - (endOfRange ? 1 : 0)).toLocaleDateString("vi-VN");

function Person({ id, name, src }: { id: string; name: string; src?: string | null | undefined }) {
  return (
    <span className="inline-flex items-center gap-1.5" data-person={id}>
      <PersonAvatar name={name} id={id} src={src} size={24} interactive={false} />
      <span>{name}</span>
    </span>
  );
}

function ActiveList({
  rows,
  onRevoke,
  busy,
}: {
  rows: Delegation[];
  onRevoke: (id: string) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const cards = usePeopleCards(rows.flatMap((d) => [d.from_user.id, d.to_user.id]));
  if (rows.length === 0) return null;
  return (
    <div className="border-t border-rule-soft px-5 py-3">
      <h3 className="m-0 mb-2 font-semibold text-sm">{t("contracts.work.u4.deleg.active")}</h3>
      <ul className="m-0 list-none p-0" data-testid="delegation-list">
        {rows.map((d) => (
          <li key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2 text-sm">
            <Person
              id={d.from_user.id}
              name={d.from_user.display_name}
              src={cards.get(d.from_user.id)?.avatar}
            />
            <span aria-hidden="true">→</span>
            <Person
              id={d.to_user.id}
              name={d.to_user.display_name}
              src={cards.get(d.to_user.id)?.avatar}
            />
            <span className="text-dim">
              · {dayText(d.from_at)} – {dayText(d.to_at, true)} ·{" "}
              {d.kinds.map((k) => t(`contracts.work.u4.deleg.kind.${k}`)).join(", ")}
            </span>
            <Button
              variant="quiet"
              size="sm"
              className="ml-auto max-sm:min-h-11"
              disabled={busy}
              onClick={() => onRevoke(d.id)}
            >
              {t("contracts.work.u4.deleg.revoke")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Nút bật/tắt loại việc; «Ký hợp đồng» khoá kèm lý do khi người được giao không thuộc nhóm người ký (DELEGATE_NOT_SIGNER). */
function KindToggle(p: {
  kind: DelegationKind;
  on: boolean;
  locked: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const btn = (
    <Button
      type="button"
      variant={p.on ? "primary" : "quiet"}
      size="sm"
      aria-pressed={p.on}
      aria-disabled={p.locked || undefined}
      data-testid={`delegation-kind-${p.kind}`}
      className={`max-sm:min-h-11 ${p.locked ? "opacity-50" : ""}`}
      onClick={() => (p.locked ? undefined : p.onToggle())}
    >
      {p.on ? "✓ " : ""}
      {t(`contracts.work.u4.deleg.kind.${p.kind}`)}
    </Button>
  );
  return p.locked ? (
    <TouchTip tip={t("contracts.work.u4.deleg.esignHint")}>
      <span className="inline-flex">{btn}</span>
    </TouchTip>
  ) : (
    <span className="inline-flex">{btn}</span>
  );
}

export function DelegationPane() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useSession((s) => s.me);
  const admin = isCompanyAdmin(me?.role);
  const [f, setF] = useState<DelegationForm>(EMPTY_DELEGATION);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [names, setNames] = useState<Record<string, string>>({});
  const list = useQuery({
    queryKey: delegationKeys.mine,
    queryFn: ({ signal }) => fetchMyDelegations(signal),
  });
  // Luật DELEGATE_NOT_SIGNER: «Ký hợp đồng» chỉ chọn được khi người được giao thuộc nhóm người ký hợp đồng.
  const elig = useQuery({
    queryKey: [...delegationKeys.mine, "esign-eligible", f.toUserId],
    queryFn: ({ signal }) => fetchEsignEligible(f.toUserId, signal),
    enabled: f.toUserId !== "",
    staleTime: 60_000,
  });
  const esignLocked = f.toUserId !== "" && elig.data?.eligible === false;
  useEffect(() => {
    if (esignLocked)
      setF((x) => (x.kinds.includes("esign") ? { ...x, kinds: withoutEsign(x.kinds) } : x));
  }, [esignLocked]);
  const issue = delegationIssue(f, me?.id ?? null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: delegationKeys.mine });
  };
  const save = useMutation({
    mutationFn: () => createDelegation(me?.tenant.id ?? null, delegationBody(f)),
    onSuccess: () => {
      setF(EMPTY_DELEGATION);
      setTried(false);
      setErr(null);
      toast(t("contracts.work.u4.deleg.saved"));
      refresh();
    },
    onError: (e) => setErr(errText(e, t)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeDelegation(id),
    onSuccess: refresh,
    onError: (e) => setErr(errText(e, t)),
  });
  const rows = activeDelegations(list.data?.items ?? [], Date.now());
  const pickers = (key: "forUser" | "person") => ({
    source: "contracts-members",
    fetchPage: fetchMembersPage,
    ariaLabel: t(`contracts.work.u4.deleg.${key}`),
  });
  const word = "text-body";
  return (
    <SettingsGroup
      title={t("contracts.work.u4.deleg.title")}
      sub={t("contracts.work.u4.deleg.sub")}
    >
      <div data-testid="delegation-pane">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-3 px-5 py-4">
          {admin ? (
            <PersonPick
              {...pickers("forUser")}
              id="dg-for"
              testId="delegation-for"
              value={f.forUserId}
              valueName={names[f.forUserId]}
              placeholder={t("contracts.work.u4.deleg.forMe")}
              clearable
              onChange={(id, name) => {
                setNames({ ...names, [id]: name });
                setF({ ...f, forUserId: id });
              }}
            />
          ) : (
            <span className={`${word} font-semibold`}>{t("contracts.work.u4.deleg.forMe")}</span>
          )}
          <span className={word}>{t("contracts.work.u4.deleg.absent")}</span>
          <DateInput
            id="dg-from"
            aria-label={t("contracts.work.u4.deleg.from")}
            className="field h-11 sm:h-10"
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
          <span className={word}>{t("contracts.work.u4.deleg.until")}</span>
          <DateInput
            id="dg-end"
            aria-label={t("contracts.work.u4.deleg.to")}
            className="field h-11 sm:h-10"
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
          <span className="basis-full" aria-hidden="true" />
          <span className={word}>{t("contracts.work.u4.deleg.assign")}</span>
          <fieldset
            aria-label={t("contracts.work.u4.deleg.kinds")}
            className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0"
          >
            {DELEGATION_KINDS.map((k) => (
              <KindToggle
                key={k}
                kind={k}
                on={f.kinds.includes(k)}
                locked={k === "esign" && esignLocked}
                onToggle={() => setF({ ...f, kinds: toggleKind(f.kinds, k) })}
              />
            ))}
          </fieldset>
          <span className={word}>{t("contracts.work.u4.deleg.forWho")}</span>
          <PersonPick
            {...pickers("person")}
            id="dg-to"
            testId="delegation-to"
            value={f.toUserId}
            valueName={names[f.toUserId]}
            excludeId={f.forUserId || me?.id}
            placeholder={t("contracts.work.u4.deleg.pick")}
            onChange={(id, name) => {
              setNames({ ...names, [id]: name });
              setF({ ...f, toUserId: id });
            }}
          />
          <Button
            variant="primary"
            className="max-sm:min-h-11"
            data-testid="delegation-save"
            disabled={save.isPending}
            onClick={() => (issue ? setTried(true) : save.mutate())}
          >
            {t("contracts.work.u4.deleg.save")}
          </Button>
        </div>
        {(tried && issue) || err ? (
          <div className="px-5 pb-3">
            {tried && issue && (
              <p role="alert" className="text-sm text-late" data-testid="delegation-issue">
                {t(`contracts.work.u4.deleg.issue.${issue}`)}
              </p>
            )}
            {err && (
              <p role="alert" className="text-sm text-late" data-testid="delegation-error">
                {err}
              </p>
            )}
          </div>
        ) : null}
        <ActiveList rows={rows} busy={revoke.isPending} onRevoke={(id) => revoke.mutate(id)} />
        <DelegationHistory tenantId={me?.tenant.id ?? null} admin={admin} />
      </div>
    </SettingsGroup>
  );
}
