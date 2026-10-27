// feedback · /feedback (tenant_admin + platform_admin): danh sách góp ý của người dùng, lọc theo tenant (chỉ platform) · app · loại · trạng thái;
// mở một dòng để đổi trạng thái (mới/đang xử lý/xong) và trả lời. Không gửi email.
import { FEEDBACK_KINDS, FEEDBACK_STATUSES, type FeedbackItem } from "@ai/contracts";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { PageHeader } from "@/components/shared/PageHeader";
import { ErrorState } from "@/components/shared/states/ErrorState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useTenantOptions } from "@/features/tenants/api";
import { useSession } from "@/lib/auth/use-session";
import { ApiError } from "@/lib/http";
import { type FeedbackFilters, PAGE_SIZE, useFeedbackList } from "../api";
import { FeedbackDetail } from "../components/FeedbackDetail";
import { TrelloConfigCard } from "../components/TrelloConfigCard";

const APPS = ["chat", "contracts", "studio", "admin"] as const;
const SELECT = "h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground";
const TONE = { new: "info", in_progress: "warn", done: "ok" } as const;

export function FeedbackPage() {
  const { t } = useTranslation();
  const platform = useSession((s) => s.me?.role === "platform_admin");
  const tenants = useTenantOptions(platform);
  const [f, setF] = useState<FeedbackFilters>({ offset: 0 });
  const [open, setOpen] = useState<FeedbackItem | null>(null);
  const list = useFeedbackList(f);
  const err = list.error instanceof ApiError ? list.error : null;
  const total = list.data?.total ?? 0;
  const set = (patch: Partial<FeedbackFilters>) => setF((p) => ({ ...p, ...patch, offset: 0 }));
  const pick = (v: string) => v || undefined;

  return (
    <>
      <PageHeader title={t("feedbackAdmin.title")} description={t("feedbackAdmin.subtitle")} />
      <TrelloConfigCard enabled={platform} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {platform ? (
          <select
            aria-label={t("feedbackAdmin.col.tenant")}
            className={SELECT}
            value={f.tenant_id ?? ""}
            onChange={(e) => set({ tenant_id: pick(e.target.value) })}
          >
            <option value="">{t("feedbackAdmin.allTenants")}</option>
            {(tenants.data ?? []).map((tn) => (
              <option key={tn.id} value={tn.id}>
                {tn.key}
              </option>
            ))}
          </select>
        ) : null}
        <select
          aria-label={t("feedbackAdmin.col.app")}
          className={SELECT}
          value={f.app ?? ""}
          onChange={(e) => set({ app: pick(e.target.value) })}
        >
          <option value="">{t("feedbackAdmin.allApps")}</option>
          {APPS.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <select
          aria-label={t("feedbackAdmin.col.kind")}
          className={SELECT}
          value={f.kind ?? ""}
          onChange={(e) => set({ kind: pick(e.target.value) as FeedbackFilters["kind"] })}
        >
          <option value="">{t("feedbackAdmin.allKinds")}</option>
          {FEEDBACK_KINDS.map((k) => (
            <option key={k} value={k}>
              {t(`feedbackAdmin.kind.${k}`)}
            </option>
          ))}
        </select>
        <select
          aria-label={t("feedbackAdmin.col.status")}
          className={SELECT}
          value={f.status ?? ""}
          onChange={(e) => set({ status: pick(e.target.value) as FeedbackFilters["status"] })}
        >
          <option value="">{t("feedbackAdmin.allStatuses")}</option>
          {FEEDBACK_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`feedbackAdmin.status.${s}`)}
            </option>
          ))}
        </select>
      </div>
      {err ? (
        <ErrorState message={err.message} code={err.code} onRetry={() => void list.refetch()} />
      ) : null}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>{t("feedbackAdmin.col.date")}</TableHead>
            {platform ? <TableHead>{t("feedbackAdmin.col.tenant")}</TableHead> : null}
            <TableHead>{t("feedbackAdmin.col.user")}</TableHead>
            <TableHead>{t("feedbackAdmin.col.app")}</TableHead>
            <TableHead>{t("feedbackAdmin.col.kind")}</TableHead>
            <TableHead>{t("feedbackAdmin.col.message")}</TableHead>
            <TableHead>{t("feedbackAdmin.col.status")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(list.data?.items ?? []).map((x) => (
            <TableRow key={x.id} className="cursor-pointer" onClick={() => setOpen(x)}>
              <TableCell className="whitespace-nowrap">{x.created_at.slice(0, 10)}</TableCell>
              {platform ? <TableCell className="font-mono">{x.tenant_name}</TableCell> : null}
              <TableCell>{x.user_name}</TableCell>
              <TableCell>{x.app}</TableCell>
              <TableCell>{t(`feedbackAdmin.kind.${x.kind}`)}</TableCell>
              <TableCell className="max-w-96 truncate">{x.message}</TableCell>
              <TableCell>
                <Badge variant={TONE[x.status]}>{t(`feedbackAdmin.status.${x.status}`)}</Badge>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {list.data && total === 0 ? (
        <p className="mt-4 text-label text-muted-foreground">{t("feedbackAdmin.empty")}</p>
      ) : null}
      {total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={f.offset === 0}
            onClick={() => setF((p) => ({ ...p, offset: Math.max(0, p.offset - PAGE_SIZE) }))}
          >
            {t("feedbackAdmin.prev")}
          </Button>
          <span className="text-label text-muted-foreground">
            {f.offset + 1}–{Math.min(total, f.offset + PAGE_SIZE)} / {total}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={f.offset + PAGE_SIZE >= total}
            onClick={() => setF((p) => ({ ...p, offset: p.offset + PAGE_SIZE }))}
          >
            {t("feedbackAdmin.next")}
          </Button>
        </div>
      ) : null}
      {open ? <FeedbackDetail key={open.id} item={open} onClose={() => setOpen(null)} /> : null}
    </>
  );
}
