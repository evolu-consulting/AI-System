// CR-161 · lát 8 · tab «Bảng tin công ty»: bài công khai của công ty đã kết nối — chỉ chữ + «N tệp» (chưa mở tệp: spec Q2), tải dần.
import { useTranslation } from "react-i18next";
import { Empty, Loading } from "~/components/shared/states";
import { Btn } from "~/components/ui/Btn";
import { usePosts } from "../hooks/use-cc-chat";

export function ConnectedFeedTab({ other, name }: { other: string; name: string }) {
  const { t, i18n } = useTranslation();
  const { q, posts } = usePosts(other, true);
  if (q.isLoading) return <Loading />;
  if (q.error)
    return (
      <p role="alert" className="text-label text-late">
        {t("contracts.connect.err.failed")}
      </p>
    );
  const fmt = new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" });
  return (
    <div className="flex flex-col gap-3" data-testid="cc-feed">
      <p className="m-0 rounded-xl border border-rule bg-sunk px-4 py-3 text-label text-dim">
        {t("contracts.connect.feed.banner", { name })}
      </p>
      {posts.length === 0 ? (
        <Empty title={t("contracts.connect.feed.empty", { name })} />
      ) : (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {posts.map((p) => (
            <li
              key={p.id}
              data-testid="cc-post"
              className="rounded-xl border border-rule bg-panel px-4 py-3"
            >
              <b className="block">{p.title}</b>
              <span className="block text-[12px] text-dim">
                {name} · {fmt.format(new Date(p.created_at))}
                {p.file_count > 0 && ` · ${t("contracts.connect.feed.files", { n: p.file_count })}`}
              </span>
              {p.body && <p className="m-0 mt-2 text-body whitespace-pre-wrap">{p.body}</p>}
            </li>
          ))}
        </ul>
      )}
      {q.hasNextPage && (
        <div className="text-center">
          <Btn
            size="sm"
            variant="outline"
            loading={q.isFetchingNextPage}
            onClick={() => void q.fetchNextPage()}
          >
            {t("contracts.connect.feed.more")}
          </Btn>
        </div>
      )}
    </div>
  );
}
