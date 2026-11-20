// CR-191 · BR-191-10/11 · CR-193 · BR-193-9 · Sổ Hợp Tác › Đối tác: thẻ «Yêu cầu chờ duyệt» (Đồng ý / Từ chối + lý do · «Lời mời mình đã gửi» (Thu hồi)).
// Chỉ quản trị công ty (Toàn quyền) bấm được; vai khác thấy nút khoá + lý do (máy chủ cũng trả 403).
import type { ConnectLink } from "@ai/contracts/pack-contracts";
import { CC_REASON_MAX } from "@ai/contracts/pack-contracts";
import { Badge } from "@ai/web-kit/ui/kit/badge";
import { ICONS } from "@ai/web-kit/ui/kit/icons";
import { toast } from "@ai/web-kit/ui/toast";
import { lazy, Suspense, useState } from "react";
import { useTranslation } from "react-i18next";
import { Btn } from "~/components/ui/Btn";
import { Input } from "~/components/ui/input";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { loadJoinReviewPane } from "~/modules/community/manifest";
import { useShellPacks } from "~/shell/use-shell-packs";
import { errCodeOf, useConnectWrites, useLinks } from "../hooks/use-connect";
import { connectErrKey } from "../lib/connect";
import { cutPending } from "../lib/pending";

const JoinPane = lazy(loadJoinReviewPane);

function useFail() {
  const { t } = useTranslation();
  return (e: unknown) => toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late");
}

function Request({ l, locked, day }: { l: ConnectLink; locked: boolean; day: string }) {
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
    <li
      data-testid="connect-request"
      className="border-b border-rule-soft py-3 first:pt-0 last:border-0"
    >
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-md bg-panel text-dim">
          <ICONS.partner className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1 basis-56">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <b className="truncate">{l.legal_name}</b>
            <Badge status="info" icon={<ICONS.partner className="size-3" />}>
              {t("contracts.connect.hub.kindConnect")}
            </Badge>
            <span className="text-xs text-dim">{day}</span>
          </div>
          <span className="block text-xs text-dim">
            {t("contracts.connect.tax", { tax: l.tax_code })}
            {by}
          </span>
          {l.note && (
            <span className="block truncate rounded-md bg-panel px-2 py-1 text-xs text-dim">
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
          <label className="grid min-w-0 flex-1 basis-64 gap-1 text-xs text-dim">
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
      className="flex flex-wrap items-center gap-3 border-b border-rule-soft py-3 last:border-0"
    >
      <div className="min-w-0 flex-1 basis-56">
        <b className="block truncate">{l.legal_name}</b>
        <span className="block text-xs text-dim">
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

const dayOf = (iso: string, lang: string) =>
  new Date(iso).toLocaleDateString(lang, { day: "2-digit", month: "2-digit", year: "numeric" });

/** CR-193 · BR-193-9 · MỘT thẻ «Yêu cầu chờ duyệt»: yêu cầu kết nối + yêu cầu vào Bảng tin (Community, nạp lười, chỉ khi gói bật) mỗi cái một dòng gọn;
 * tối đa 3 dòng + «Xem thêm N» mở tại chỗ; «Lời mời mình đã gửi» ở cuối. Không có gì ⇒ ẩn thẻ. */
export function PendingRequestsCard() {
  const { t, i18n } = useTranslation();
  const { owner } = useMe();
  const packs = useShellPacks();
  const locked = !owner;
  const reqs = useLinks("pending_in").data?.items ?? [];
  const sent = useLinks("pending_out").data?.items ?? [];
  const [expanded, setExpanded] = useState(false);
  const [joinN, setJoinN] = useState(0);
  const cut = cutPending(reqs.length, joinN, expanded);
  if (reqs.length + joinN + sent.length === 0 && packs.community !== true) return null;
  const empty = reqs.length + joinN + sent.length === 0;
  return (
    <section
      data-testid="connect-hub"
      aria-label={t("contracts.connect.hub.pendingTitle")}
      hidden={empty}
      className="mb-4 shrink-0 rounded-lg border border-rule-soft bg-card px-5 py-4"
    >
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink">
        {t("contracts.connect.hub.pendingTitle")}
        {reqs.length + joinN > 0 && (
          <span className="rounded-full bg-panel px-2 text-xs text-dim">{reqs.length + joinN}</span>
        )}
      </h2>
      <ul data-testid="connect-requests">
        {reqs.slice(0, cut.connectShown).map((l) => (
          <Request key={l.tenant_id} l={l} locked={locked} day={dayOf(l.since, i18n.language)} />
        ))}
      </ul>
      {packs.community === true && (
        <Suspense fallback={null}>
          <JoinPane budget={cut.joinBudget} onCount={setJoinN} />
        </Suspense>
      )}
      {cut.canToggle && (
        <div className="border-t border-rule-soft pt-2 text-center">
          <Btn
            size="sm"
            variant="quiet"
            aria-expanded={expanded}
            data-testid="pending-more"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded
              ? t("contracts.connect.hub.less")
              : t("contracts.connect.hub.more", { n: cut.hidden })}
          </Btn>
        </div>
      )}
      {sent.length > 0 && (
        <>
          <h3 className="mt-3 border-t border-rule-soft pt-3 text-xs font-semibold text-dim">
            {t("contracts.connect.hub.sentSub")}
          </h3>
          <ul data-testid="connect-sent-list">
            {sent.map((l) => (
              <Sent key={l.tenant_id} l={l} locked={locked} />
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
