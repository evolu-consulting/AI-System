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
import { fetchMembers, MEMBERS_KEY } from "~/features/contracts-list/api";
import { isCompanyAdmin } from "~/features/shell/lib/nav";
import { cr127ErrorKey } from "~/platform/flow/lib/claim";
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
  const members = useQuery({
    queryKey: MEMBERS_KEY,
    queryFn: ({ signal }) => fetchMembers(signal),
  });
  const people = members.data?.items ?? [];
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
            <select
              id="dg-for"
              className="field h-10 w-full"
              value={f.forUserId}
              onChange={(e) => setF({ ...f, forUserId: e.target.value })}
            >
              <option value="">{t("contracts.work.u4.deleg.forMe")}</option>
              {people.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </SettingsRow>
        )}
        <SettingsRow
          label={t("contracts.work.u4.deleg.person")}
          hint={t("contracts.work.u4.deleg.personHint")}
          htmlFor="dg-to"
        >
          <select
            id="dg-to"
            className="field h-10 w-full"
            value={f.toUserId}
            onChange={(e) => setF({ ...f, toUserId: e.target.value })}
          >
            <option value="">{t("contracts.work.u4.deleg.pick")}</option>
            {people
              .filter((m) => m.id !== (f.forUserId || me?.id))
              .map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
          </select>
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
