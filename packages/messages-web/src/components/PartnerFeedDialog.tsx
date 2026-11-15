// CR-169 · lát 6 · «Bảng tin <Công ty>»: bài công khai (đã che) của công ty đã kết nối — chỉ đọc, chỉ chữ + «N tệp», tải dần.
// Chuyển từ `ConnectedFeedTab` của trang đối tác (CR-161); mở từ nút đầu danh sách khi lọc một công ty.
import { EmptyState } from "@ai/web-kit/ui/EmptyState";
import { useTranslation } from "react-i18next";
import { useFeed } from "../hooks/use-feed";
import { listTime } from "../lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Skeleton,
} from "../ui";
import { LoadSentinel } from "./LoadSentinel";

const TYPE_KEY = {
  sell: "contracts.messages.feed.sell",
  buy: "contracts.messages.feed.buy",
  note: "contracts.messages.feed.note",
} as const;

function Body({ tenant, company }: { tenant: string; company: string }) {
  const { t } = useTranslation();
  const feed = useFeed(tenant, true);
  if (feed.isPending)
    return (
      <div className="space-y-3" data-testid="feed-loading">
        {[0, 1, 2].map((i) => (
          <Skeleton key={i} className="h-16 w-full" />
        ))}
      </div>
    );
  if (feed.isError)
    return (
      <EmptyState
        kind="error"
        title={t("contracts.messages.feed.error")}
        action={
          <button type="button" className="btn btn-sm" onClick={() => void feed.refetch()}>
            {t("contracts.messages.retry")}
          </button>
        }
      />
    );
  if (feed.items.length === 0)
    return (
      <EmptyState
        kind="empty"
        testId="feed-empty"
        title={t("contracts.messages.feed.empty", { company })}
      />
    );
  return (
    <>
      <ul className="m-0 list-none space-y-2 p-0" data-testid="feed-list">
        {feed.items.map((p) => (
          <li key={p.id} data-testid="feed-post" className="rounded-lg border border-rule-soft p-3">
            <div className="flex items-baseline gap-2 text-micro text-dim">
              <span className="font-semibold uppercase">{t(TYPE_KEY[p.type])}</span>
              <time dateTime={p.created_at}>{listTime(p.created_at)}</time>
            </div>
            <p className="m-0 mt-0.5 text-[14px] font-semibold">{p.title}</p>
            {p.body && <p className="m-0 mt-0.5 whitespace-pre-wrap text-label">{p.body}</p>}
            {p.file_count > 0 && (
              <p className="m-0 mt-1 text-micro text-dim" data-testid="feed-files">
                {t("contracts.messages.feed.files", { n: p.file_count })}
              </p>
            )}
          </li>
        ))}
      </ul>
      {feed.hasNextPage && (
        <LoadSentinel loading={feed.isFetchingNextPage} onMore={() => void feed.fetchNextPage()} />
      )}
    </>
  );
}

export function PartnerFeedDialog({
  open,
  tenant,
  company,
  onClose,
}: {
  open: boolean;
  tenant: string;
  company: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      <DialogContent data-testid="feed-dialog" className="max-h-[80dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t("contracts.messages.feed.title", { company })}</DialogTitle>
          <DialogDescription>{t("contracts.messages.feed.hint")}</DialogDescription>
        </DialogHeader>
        {open && <Body tenant={tenant} company={company} />}
        <div className="flex justify-end">
          <button type="button" className="btn" onClick={onClose}>
            {t("contracts.messages.close")}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
