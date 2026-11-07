// CR-124 · q4 · FLOW4-FR-06/14 · mục «Hợp đồng đối tác gửi» của app Hợp đồng: lời mời nối lần đầu (Nhận / Chặn) ở đầu trang, rồi mỗi dòng một HĐ nhận
// (thẻ 3 dòng). Mở một dòng ⇒ trang HĐ nhận (thẻ duyệt của quy trình nhận). Luật nhận đặt ở Công ty › Quy trình (không cấu hình ở đây).
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { answerInvite, fetchInbox, partnerKeys } from "../api";
import { PartnerCard } from "../components/PartnerCard";
import { type Invite, inboxCard } from "../lib/partner-view";

function InviteRow({ inv }: { inv: Invite }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const m = useMutation({
    mutationFn: (act: "accept" | "block") => answerInvite(inv.from_tenant, act),
    onSuccess: () => qc.invalidateQueries({ queryKey: partnerKeys.inbox }),
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

export function PartnerInboxPage() {
  const { t } = useTranslation();
  const q = useQuery({
    queryKey: partnerKeys.inbox,
    queryFn: ({ signal }) => fetchInbox(signal),
    retry: false,
  });
  const d = q.data;
  return (
    <section
      data-testid="partner-inbox"
      className="mx-auto flex w-full max-w-3xl flex-col gap-3 p-6"
    >
      <h1 className="text-lg font-semibold">{t("contracts.partner.inbox.title")}</h1>
      {q.isError && (
        <p role="alert" className="text-late">
          {t("contracts.partner.inbox.error")}
        </p>
      )}
      {d && d.invites.length > 0 && (
        <div className="flex flex-col gap-2">
          {d.invites.map((i) => (
            <InviteRow key={i.from_tenant} inv={i} />
          ))}
        </div>
      )}
      {d && d.items.length === 0 && d.invites.length === 0 && (
        <p data-testid="partner-inbox-empty" className="text-dim">
          {t("contracts.partner.inbox.empty")}
        </p>
      )}
      {d && d.items.length > 0 && (
        <div className="flex flex-col gap-2">
          {d.items.map((i) => (
            <PartnerCard
              key={i.contract_id}
              testId="partner-inbox-card"
              title={i.title}
              card={inboxCard(i)}
              right={
                <Link
                  to="/contracts/c/$id"
                  params={{ id: i.contract_id }}
                  className="btn btn-sm btn-quiet"
                >
                  {t("contracts.partner.inbox.open")}
                </Link>
              }
            />
          ))}
        </div>
      )}
    </section>
  );
}
