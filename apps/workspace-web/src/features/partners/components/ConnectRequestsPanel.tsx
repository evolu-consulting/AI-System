// CR-191 · BR-191-10/11 · Sổ Hợp Tác › Đối tác: «Yêu cầu kết nối» (Đồng ý / Từ chối + lý do) · «Lời mời đã gửi» (Thu hồi) · cài đặt
// «Ai được tìm và mời đối tác mới». Chỉ quản trị công ty (Toàn quyền) bấm được; vai khác thấy nút khoá + lý do (máy chủ cũng trả 403).
import type { ConnectInviteBy, ConnectLink } from "@ai/contracts/pack-contracts";
import { CC_REASON_MAX } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Panel } from "~/components/shared/layout";
import { Btn } from "~/components/ui/Btn";
import { Input } from "~/components/ui/input";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { errCodeOf, useConnectSettings, useConnectWrites, useLinks } from "../hooks/use-connect";
import { connectErrKey } from "../lib/connect";

function useFail() {
  const { t } = useTranslation();
  return (e: unknown) => toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late");
}

function Request({ l, locked }: { l: ConnectLink; locked: boolean }) {
  const { t } = useTranslation();
  const { accept, decline } = useConnectWrites();
  const fail = useFail();
  const [asking, setAsking] = useState(false);
  const [reason, setReason] = useState("");
  const busy = accept.isPending || decline.isPending;
  const by = l.invited_by_name
    ? ` · ${t("contracts.connect.invite.by", { who: l.invited_by_name })}`
    : "";
  return (
    <li data-testid="connect-request" className="border-b border-rule-soft px-5 py-3 last:border-0">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1 basis-56">
          <b className="block truncate">{l.legal_name}</b>
          <span className="block text-[13px] text-dim">
            {t("contracts.connect.tax", { tax: l.tax_code })}
            {by}
          </span>
          {l.note && (
            <span className="block text-[13px] text-dim">
              {t("contracts.connect.invite.note", { note: l.note })}
            </span>
          )}
        </div>
        <Btn
          size="sm"
          variant="primary"
          loading={accept.isPending}
          disabled={busy || locked}
          title={locked ? t("contracts.connect.hub.lockedWhy") : undefined}
          onClick={() =>
            accept.mutate(l.tenant_id, {
              onSuccess: () =>
                toast(t("contracts.connect.invite.accepted", { name: l.legal_name })),
              onError: fail,
            })
          }
        >
          {t("contracts.connect.invite.accept")}
        </Btn>
        <Btn
          size="sm"
          variant="quiet"
          disabled={busy || locked}
          title={locked ? t("contracts.connect.hub.lockedWhy") : undefined}
          onClick={() => setAsking((v) => !v)}
        >
          {t("contracts.connect.hub.declineBtn")}
        </Btn>
      </div>
      {asking && !locked && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="grid min-w-0 flex-1 basis-64 gap-1 text-[13px] text-dim">
            {t("contracts.connect.hub.declineReason")}
            <Input
              value={reason}
              maxLength={CC_REASON_MAX}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <Btn
            size="sm"
            variant="danger"
            loading={decline.isPending}
            onClick={() =>
              decline.mutate(
                { tenant: l.tenant_id, reason: reason.trim() },
                { onSuccess: () => toast(t("contracts.connect.hub.declined")), onError: fail },
              )
            }
          >
            {t("contracts.connect.hub.declineSend")}
          </Btn>
          <Btn size="sm" variant="quiet" onClick={() => setAsking(false)}>
            {t("contracts.connect.hub.declineKeep")}
          </Btn>
        </div>
      )}
    </li>
  );
}

function Sent({ l, locked }: { l: ConnectLink; locked: boolean }) {
  const { t } = useTranslation();
  const { withdraw } = useConnectWrites();
  const fail = useFail();
  return (
    <li
      data-testid="connect-sent"
      className="flex flex-wrap items-center gap-3 border-b border-rule-soft px-5 py-3 last:border-0"
    >
      <div className="min-w-0 flex-1 basis-56">
        <b className="block truncate">{l.legal_name}</b>
        <span className="block text-[13px] text-dim">
          {t("contracts.connect.tax", { tax: l.tax_code })}
        </span>
      </div>
      <Btn
        size="sm"
        variant="outline"
        loading={withdraw.isPending}
        disabled={locked}
        title={locked ? t("contracts.connect.hub.lockedWhy") : undefined}
        onClick={() =>
          withdraw.mutate(l.tenant_id, {
            onSuccess: () => toast(t("contracts.connect.hub.withdrawn")),
            onError: fail,
          })
        }
      >
        {t("contracts.connect.hub.withdraw")}
      </Btn>
    </li>
  );
}

function Block({
  title,
  empty,
  items,
  render,
  testId,
}: {
  title: string;
  empty: string;
  items: ConnectLink[];
  render: (l: ConnectLink) => React.ReactNode;
  testId: string;
}) {
  return (
    <Panel className="mb-3">
      <h2 className="px-5 pt-3 text-[13px] font-semibold text-dim">{title}</h2>
      {items.length === 0 ? (
        <p className="px-5 py-3 text-[13px] text-dim">{empty}</p>
      ) : (
        <ul data-testid={testId}>{items.map(render)}</ul>
      )}
    </Panel>
  );
}

function InviteSetting({ locked }: { locked: boolean }) {
  const { t } = useTranslation();
  const q = useConnectSettings();
  const { setInviteBy } = useConnectWrites();
  const fail = useFail();
  if (!q.data) return null;
  const OPTS: ConnectInviteBy[] = ["admin", "all"];
  return (
    <section
      data-testid="connect-setting"
      className="mb-3 flex flex-wrap items-start justify-between gap-4 rounded-lg border border-rule-soft bg-card px-5 py-4"
    >
      <div className="grid gap-1">
        <span className="font-semibold text-ink">{t("contracts.connect.hub.settingTitle")}</span>
        {locked && (
          <p data-testid="connect-locked-why" className="text-[13px] text-dim">
            {t("contracts.connect.hub.lockedWhy")}
          </p>
        )}
      </div>
      <fieldset
        className="m-0 flex gap-1.5 border-0 p-0"
        disabled={locked || setInviteBy.isPending}
      >
        {OPTS.map((o) => (
          <button
            key={o}
            type="button"
            className="chip max-sm:min-h-11"
            data-testid={`connect-setting-${o}`}
            aria-pressed={q.data?.invite_by === o}
            onClick={() =>
              q.data?.invite_by !== o &&
              setInviteBy.mutate(o, {
                onSuccess: () => toast(t("contracts.connect.hub.settingSaved")),
                onError: fail,
              })
            }
          >
            {t(
              o === "admin"
                ? "contracts.connect.hub.settingAdmin"
                : "contracts.connect.hub.settingAll",
            )}
          </button>
        ))}
      </fieldset>
    </section>
  );
}

export function ConnectRequestsPanel() {
  const { t } = useTranslation();
  const { owner } = useMe();
  const locked = !owner;
  const reqs = useLinks("pending_in");
  const sent = useLinks("pending_out");
  return (
    <div data-testid="connect-hub">
      <Block
        title={t("contracts.connect.hub.requestsTitle")}
        empty={t("contracts.connect.hub.requestsEmpty")}
        items={reqs.data?.items ?? []}
        render={(l) => <Request key={l.tenant_id} l={l} locked={locked} />}
        testId="connect-requests"
      />
      <Block
        title={t("contracts.connect.hub.sentTitle")}
        empty={t("contracts.connect.hub.sentEmpty")}
        items={sent.data?.items ?? []}
        render={(l) => <Sent key={l.tenant_id} l={l} locked={locked} />}
        testId="connect-sent-list"
      />
      <InviteSetting locked={locked} />
    </div>
  );
}
