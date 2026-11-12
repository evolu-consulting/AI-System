// CR-127 · U6 · M2c · băng «lời mời nối lần đầu» ở đầu danh sách Hợp đồng (thay trang «Hợp đồng đối tác gửi» đã gỡ): công ty gửi lần đầu ⇒ Nhận / Chặn.
// HĐ đối tác gửi đã nhận nằm ngay trong danh sách (lọc Nguồn = Đối tác gửi). Không có lời mời ⇒ không vẽ gì.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { answerInvite, fetchInbox, partnerKeys } from "~/features/partner-inbox/api";
import type { Invite } from "~/features/partner-inbox/lib/partner-view";

function InviteRow({ inv }: { inv: Invite }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (act: "accept" | "block") => answerInvite(inv.from_tenant, act),
    onSuccess: () => qc.invalidateQueries(),
  });
  return (
    <div
      data-testid="partner-invite"
      className="flex items-center gap-4 rounded-xl border border-soon-line bg-soon-bg px-4 py-3 text-sm"
    >
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <b className="truncate">{t("contracts.partner.invite.title", { sender: inv.from_name })}</b>
        <span className="text-dim">
          {inv.from_verified ? t("contracts.partner.verified") : t("contracts.partner.unverified")}{" "}
          · {t("contracts.partner.invite.first", { n: inv.held })}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-sm btn-primary"
        disabled={m.isPending}
        onClick={() => m.mutate("accept")}
      >
        {t("contracts.partner.invite.accept")}
      </button>
      <button
        type="button"
        className="btn btn-sm btn-quiet"
        disabled={m.isPending}
        onClick={() => m.mutate("block")}
      >
        {t("contracts.partner.invite.block")}
      </button>
    </div>
  );
}

export function PartnerInviteBand() {
  const q = useQuery({
    queryKey: partnerKeys.inbox,
    queryFn: ({ signal }) => fetchInbox(signal),
    retry: false,
    staleTime: 30_000,
  });
  const invites = q.data?.invites ?? [];
  if (invites.length === 0) return null;
  return (
    <div className="mb-3 flex flex-col gap-2">
      {invites.map((i) => (
        <InviteRow key={i.from_tenant} inv={i} />
      ))}
    </div>
  );
}
