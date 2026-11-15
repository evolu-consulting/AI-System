// CR-161 · băng lời mời kết nối đến: Đồng ý / Từ chối (từ chối có hộp xác nhận). Chỉ người Toàn quyền thấy; không có lời mời ⇒ không vẽ gì.
// Dùng chung ở trang Đối tác và Hộp thư đối tác (danh sách Hợp đồng).
import type { ConnectLink } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { useTranslation } from "react-i18next";
import { confirmDialog } from "~/components/shared/dialog-bus";
import { Btn } from "~/components/ui/Btn";
import { useMe } from "~/features/pack-state/hooks/use-me";
import { errCodeOf, useConnectWrites, useLinks } from "../hooks/use-connect";
import { connectErrKey } from "../lib/connect";

function Row({ l }: { l: ConnectLink }) {
  const { t } = useTranslation();
  const { accept, decline } = useConnectWrites();
  const busy = accept.isPending || decline.isPending;
  const fail = (e: unknown) =>
    toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late");
  const refuse = async () => {
    const ok = await confirmDialog({
      title: t("contracts.connect.decline.title", { name: l.legal_name }),
      body: t("contracts.connect.decline.body", { name: l.legal_name }),
      confirmLabel: t("contracts.connect.decline.confirm"),
      cancelLabel: t("contracts.connect.decline.keep"),
      danger: true,
    });
    if (ok) decline.mutate(l.tenant_id, { onError: fail });
  };
  const by = l.invited_by_name
    ? ` · ${t("contracts.connect.invite.by", { who: l.invited_by_name })}`
    : "";
  return (
    <div
      data-testid="connect-invite"
      className="flex flex-wrap items-center gap-4 rounded-xl border border-soon-line bg-soon-bg px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 flex-1 basis-64 flex-col gap-0.5">
        <b className="truncate">{t("contracts.connect.invite.title", { name: l.legal_name })}</b>
        <span className="text-dim">
          {l.verified ? t("contracts.connect.verified") : t("contracts.connect.unverified")} ·{" "}
          {t("contracts.connect.tax", { tax: l.tax_code })}
          {by}
        </span>
        {l.note && (
          <span className="text-dim">{t("contracts.connect.invite.note", { note: l.note })}</span>
        )}
      </div>
      <div className="flex gap-2">
        <Btn
          size="sm"
          variant="primary"
          loading={accept.isPending}
          disabled={busy}
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
        <Btn size="sm" variant="quiet" disabled={busy} onClick={() => void refuse()}>
          {t("contracts.connect.invite.decline")}
        </Btn>
      </div>
    </div>
  );
}

export function InviteBanner() {
  const { owner } = useMe();
  const q = useLinks("pending_in", owner);
  const items = q.data?.items ?? [];
  if (!owner || items.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {items.map((l) => (
        <Row key={l.tenant_id} l={l} />
      ))}
    </div>
  );
}
