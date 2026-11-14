// CR-127 · U4 · M14 · BR-31…34 · «Uỷ quyền khi vắng»: chọn người làm thay + khoảng ngày + loại việc (Duyệt · Bổ sung thông tin · Xác nhận
// mốc · Ký số); danh sách uỷ quyền còn hiệu lực + Thu hồi. Quản trị công ty đặt thay người khác (chọn «Đặt cho»).
// Lệch mock: nằm trong Cài đặt › Quy trình duyệt (không có trang «Hồ sơ của tôi» riêng ở app này).
import { DELEGATION_KINDS } from "@ai/contracts/chat";
import { ApiError } from "@ai/web-kit/http";
import { DateInput } from "@ai/web-kit/ui/DateInput";
import { toast } from "@ai/web-kit/ui/toast";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useSession } from "~/features/auth/hooks/use-session";
import { fetchMembersPage } from "~/features/contracts-list/api";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
import { PersonSearchSelect } from "~/shared/ui/PersonSearchSelect";
import { SettingsGroup, SettingsRow } from "~/shared/ui/settings-layout";
import {
  createDelegation,
  delegationKeys,
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
} from "../lib/delegation";

const errText = (e: unknown, t: (k: string) => string): string => {
  const k = e instanceof ApiError ? cr127ErrorKey(e.code as string) : null;
  return k ? t(k) : t("contracts.errors.unknown");
};

export function DelegationPane() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const me = useSession((s) => s.me);
  const admin = isCompanyAdmin(me?.role);
  const [f, setF] = useState<DelegationForm>(EMPTY_DELEGATION);
  const [tried, setTried] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const list = useQuery({
    queryKey: delegationKeys.mine,
    queryFn: ({ signal }) => fetchMyDelegations(signal),
  });
  const [names, setNames] = useState<Record<string, string>>({});
  const issue = delegationIssue(f, me?.id ?? null);
  const save = useMutation({
    mutationFn: () => createDelegation(me?.tenant.id ?? null, delegationBody(f)),
    onSuccess: () => {
      setF(EMPTY_DELEGATION);
      setTried(false);
      setErr(null);
      toast(t("contracts.work.u4.deleg.saved"));
      void qc.invalidateQueries({ queryKey: delegationKeys.mine });
    },
    onError: (e) => setErr(errText(e, t)),
  });
  const revoke = useMutation({
    mutationFn: (id: string) => revokeDelegation(id),
    onSuccess: () => void qc.invalidateQueries({ queryKey: delegationKeys.mine }),
    onError: (e) => setErr(errText(e, t)),
  });
  const rows = activeDelegations(list.data?.items ?? [], Date.now());
  return (
    <SettingsGroup
      title={t("contracts.work.u4.deleg.title")}
      sub={t("contracts.work.u4.deleg.sub")}
    >
      <div data-testid="delegation-pane">
        {admin && (
          <SettingsRow label={t("contracts.work.u4.deleg.forUser")} htmlFor="dg-for">
            <PersonSearchSelect
              id="dg-for"
              source="contracts-members"
              fetchPage={fetchMembersPage}
              value={f.forUserId}
              valueName={names[f.forUserId]}
              noneLabel={t("contracts.work.u4.deleg.forMe")}
              onChange={(id, name) => {
                setNames({ ...names, [id]: name });
                setF({ ...f, forUserId: id });
              }}
            />
          </SettingsRow>
        )}
        <SettingsRow
          label={t("contracts.work.u4.deleg.person")}
          hint={t("contracts.work.u4.deleg.personHint")}
          htmlFor="dg-to"
        >
          <PersonSearchSelect
            id="dg-to"
            source="contracts-members"
            fetchPage={fetchMembersPage}
            value={f.toUserId}
            valueName={names[f.toUserId]}
            excludeId={f.forUserId || me?.id}
            noneLabel={t("contracts.work.u4.deleg.pick")}
            onChange={(id, name) => {
              setNames({ ...names, [id]: name });
              setF({ ...f, toUserId: id });
            }}
          />
        </SettingsRow>
        <SettingsRow label={t("contracts.work.u4.deleg.from")} htmlFor="dg-from">
          <DateInput
            id="dg-from"
            className="field h-10"
            value={f.from}
            onChange={(e) => setF({ ...f, from: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow label={t("contracts.work.u4.deleg.to")} htmlFor="dg-end">
          <DateInput
            id="dg-end"
            className="field h-10"
            value={f.to}
            onChange={(e) => setF({ ...f, to: e.target.value })}
          />
        </SettingsRow>
        <SettingsRow
          label={t("contracts.work.u4.deleg.kinds")}
          hint={t("contracts.work.u4.deleg.esignHint")}
        >
          <div className="flex flex-wrap gap-3">
            {DELEGATION_KINDS.map((k) => (
              <label key={k} className="flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  checked={f.kinds.includes(k)}
                  onChange={() => setF({ ...f, kinds: toggleKind(f.kinds, k) })}
                />
                {t(`contracts.work.u4.deleg.kind.${k}`)}
              </label>
            ))}
          </div>
        </SettingsRow>
        <div className="flex flex-col gap-2 border-t border-rule-soft px-5 py-3">
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
          <button
            type="button"
            className="btn btn-primary w-fit"
            data-testid="delegation-save"
            disabled={save.isPending}
            onClick={() => (issue ? setTried(true) : save.mutate())}
          >
            {t("contracts.work.u4.deleg.save")}
          </button>
        </div>
        {rows.length > 0 && (
          <ul className="m-0 list-none border-t border-rule-soft p-0" data-testid="delegation-list">
            {rows.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 border-b border-rule-soft px-5 py-3 text-sm last:border-b-0"
              >
                <span className="min-w-0 flex-1">
                  {t("contracts.work.u4.deleg.row", {
                    from: d.from_user.display_name,
                    to: d.to_user.display_name,
                    start: new Date(d.from_at).toLocaleDateString("vi-VN"),
                    end: new Date(Date.parse(d.to_at) - 1).toLocaleDateString("vi-VN"),
                  })}
                </span>
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(d.id)}
                >
                  {t("contracts.work.u4.deleg.revoke")}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </SettingsGroup>
  );
}
