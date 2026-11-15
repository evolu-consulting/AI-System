// CR-161 · hộp «Tìm công ty»: gõ tên hoặc MST (≥ 3 ký tự) ⇒ danh sách công ty đã bật Danh bạ, mỗi dòng nói tình trạng và việc kế tiếp.
// «Gửi lời mời kết nối» có hộp xác nhận + lời nhắn tuỳ chọn. Chỉ mở cho người Toàn quyền.
import type { ConnectCompany } from "@ai/contracts/pack-contracts";
import { toast } from "@ai/web-kit/ui/toast";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { promptDialog } from "~/components/shared/dialog-bus";
import { Btn, btnClass } from "~/components/ui/Btn";
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { errCodeOf, useCompanySearch, useConnectWrites } from "../hooks/use-connect";
import { connectErrKey, noteOf, partnerSearchOf, searchReady } from "../lib/connect";
import { ConnectStatusBadge } from "./ConnectStatusBadge";

function Line({ c }: { c: ConnectCompany }) {
  const { t } = useTranslation();
  const { invite, accept } = useConnectWrites();
  const fail = (e: unknown) =>
    toast(t(`contracts.connect.err.${connectErrKey(errCodeOf(e))}`), "late");
  const send = async () => {
    const raw = await promptDialog({
      title: t("contracts.connect.send.title", { name: c.legal_name }),
      body: t("contracts.connect.send.body", { name: c.legal_name }),
      label: t("contracts.connect.send.note"),
      maxLength: 500,
      confirmLabel: t("contracts.connect.send.confirm"),
      cancelLabel: t("contracts.connect.send.later"),
    });
    if (raw === null) return;
    invite.mutate(
      { tenant_id: c.tenant_id, note: noteOf(raw) },
      {
        onSuccess: () => toast(t("contracts.connect.send.done", { name: c.legal_name })),
        onError: fail,
      },
    );
  };
  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-rule-soft py-3 last:border-0">
      <div className="min-w-0 flex-1 basis-56">
        <b className="block truncate">{c.legal_name}</b>
        <span className="block text-[13px] text-dim">
          {t("contracts.connect.tax", { tax: c.tax_code })} ·{" "}
          {c.verified ? t("contracts.connect.verified") : t("contracts.connect.unverified")}
        </span>
        {c.status === "declined" && (
          <span className="block text-[13px] text-late">{t("contracts.connect.cannotResend")}</span>
        )}
      </div>
      <ConnectStatusBadge status={c.status} />
      {c.status === "connected" && (
        <Link
          to="/contracts/partners"
          search={partnerSearchOf(c)}
          className={btnClass("outline", "sm")}
        >
          {t("contracts.connect.openPartner")}
        </Link>
      )}
      {c.status === "none" && (
        <Btn size="sm" variant="primary" loading={invite.isPending} onClick={() => void send()}>
          {t("contracts.connect.send.button")}
        </Btn>
      )}
      {c.status === "pending_in" && (
        <Btn
          size="sm"
          variant="primary"
          loading={accept.isPending}
          onClick={() => accept.mutate(c.tenant_id, { onError: fail })}
        >
          {t("contracts.connect.invite.accept")}
        </Btn>
      )}
    </li>
  );
}

function Results({ q, raw }: { q: string; raw: string }) {
  const { t } = useTranslation();
  const res = useCompanySearch(q);
  if (!searchReady(raw))
    return <p className="text-[13px] text-dim">{t("contracts.connect.search.short")}</p>;
  if (q.trim() !== raw.trim() || res.isLoading)
    return (
      <p role="status" className="text-[13px] text-dim">
        {t("contracts.connect.search.loading")}
      </p>
    );
  if (res.error)
    return (
      <p role="alert" className="text-[13px] text-late">
        {t(`contracts.connect.err.${connectErrKey(errCodeOf(res.error))}`)}
      </p>
    );
  const items = res.data?.items ?? [];
  if (!items.length)
    return <p className="text-[13px] text-dim">{t("contracts.connect.search.none")}</p>;
  return (
    <ul data-testid="connect-results">
      {items.map((c) => (
        <Line key={c.tenant_id} c={c} />
      ))}
    </ul>
  );
}

export function ConnectSearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [raw, setRaw] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const h = setTimeout(() => setQ(raw), 300);
    return () => clearTimeout(h);
  }, [raw]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent aria-label={t("contracts.connect.search.title")}>
        <DialogHeader>
          <DialogTitle>{t("contracts.connect.search.title")}</DialogTitle>
          <DialogDescription>{t("contracts.connect.search.hint")}</DialogDescription>
        </DialogHeader>
        <DialogBody>
          <div className="space-y-1.5">
            <Label htmlFor="connect-q">{t("contracts.connect.search.label")}</Label>
            <Input
              id="connect-q"
              value={raw}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => setRaw(e.target.value)}
            />
          </div>
          <Results q={q} raw={raw} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
