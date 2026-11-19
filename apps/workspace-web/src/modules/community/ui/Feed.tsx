// Bảng tin: FeedPage (một cột: composer + thanh dính có nút «Lọc» + bài gộp) và FeedList (Profile: chip + lọc gọn).

import type {
  FeedQuery,
  FeedResponse,
  FeedTab,
  ModerationItem,
  PartnerOrg,
} from "@ai/contracts/community";
import { Button } from "@ai/web-kit/ui/kit/button";
import { Input } from "@ai/web-kit/ui/kit/input";
import { useEffect, useRef, useState } from "react";
import { OptionSelect } from "~/shared/ui/OptionSelect";
import { useApp } from "../application/ctx";
import { useFocusPost } from "../application/focus-post";
import { usePeopleCards } from "../application/use-people-cards";
import { useConnected, useFeed, useFeedFilters } from "../application/useFeed";
import { composerCompact, useNarrow, useStuck } from "../application/useStuck";
import { hasActiveFilter } from "../domain/filters";
import { t } from "../i18n";
import { Composer } from "./Composer";
import { FeedFilterSheet } from "./FeedFilterSheet";
import { PostCard } from "./PostCard";

const TABS: { id: FeedTab }[] = [
  { id: "all" },
  { id: "sell" },
  { id: "buy" },
  { id: "note" },
  { id: "archived" },
];
const tabLabel = (id: FeedTab): string => t(`community.feed.tabs.${id}`);

type Filters = ReturnType<typeof useFeedFilters>;

type Props = {
  fixed?: Pick<FeedQuery, "mine" | "authorOrgId" | "authorUserId">;
  tabs?: FeedTab[];
  withFilters?: boolean;
  /** Trạng thái duyệt của bài tôi theo id (một lần gọi cho cả danh sách). */
  mods?: ReadonlyMap<string, ModerationItem>;
};

/** CR-151 · chọn người đăng = công ty: ô tìm ở máy chủ (50 công ty/lần), giữ công ty đang chọn. */
function AuthorSelect({ f }: { f: Filters }) {
  const { api } = useApp();
  const [qRaw, setQRaw] = useState("");
  const [list, setList] = useState<PartnerOrg[]>([]);
  const [picked, setPicked] = useState<PartnerOrg | null>(null);
  useEffect(() => {
    const h = setTimeout(() => {
      api.listPartners({ q: qRaw.trim(), limit: 50, offset: 0 }).then(setList, () => undefined);
    }, 250);
    return () => clearTimeout(h);
  }, [api, qRaw]);
  const shown = picked && !list.some((p) => p.id === picked.id) ? [picked, ...list] : list;
  return (
    <>
      <Input
        type="search"
        value={qRaw}
        placeholder={t("community.feed.filters.authorSearch")}
        aria-label={t("community.feed.filters.authorSearch")}
        onChange={(e) => setQRaw(e.target.value)}
      />
      <OptionSelect
        aria-label={t("community.feed.filters.author")}
        value={f.author}
        onValueChange={(v) => {
          f.setAuthor(v);
          setPicked(list.find((p) => p.id === v) ?? null);
        }}
      >
        <option value="">{t("community.feed.filters.authorAll")}</option>
        <option value="host">{t("community.feed.filters.host")}</option>
        {shown.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </OptionSelect>
    </>
  );
}

/** Ba ô chọn nhóm hàng / khu vực / người đăng + nút Xoá lọc. */
export function FeedFilters({
  f,
  data,
  className,
}: {
  f: Filters;
  data: FeedResponse;
  className: string;
}) {
  const { isHostViewer } = useApp();
  return (
    <div className={className}>
      <OptionSelect
        aria-label={t("community.feed.filters.cat")}
        value={f.cat}
        onValueChange={(v) => f.setCat(v)}
      >
        <option value="">{t("community.feed.filters.catAll")}</option>
        {data.facets.cats.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </OptionSelect>
      <OptionSelect
        aria-label={t("community.feed.filters.area")}
        value={f.area}
        onValueChange={(v) => f.setArea(v)}
      >
        <option value="">{t("community.feed.filters.areaAll")}</option>
        {data.facets.areas.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </OptionSelect>
      {isHostViewer && <AuthorSelect f={f} />}
      {hasActiveFilter({
        tab: f.tab,
        cat: f.cat,
        area: f.area,
        authorOrgId: f.author,
      }) && (
        <Button variant="link" onClick={f.clear}>
          {t("community.feed.filters.clear")}
        </Button>
      )}
    </div>
  );
}

type MoreFeed = ReturnType<typeof useFeed>["more"];

/** Tải dần: chạm cuối danh sách (IntersectionObserver) ⇒ nạp trang kế; nút «Xem thêm bài» là đường dự phòng (bàn phím / không có observer). */
function FeedMore({ more }: { more: MoreFeed }) {
  const ref = useRef<HTMLButtonElement>(null);
  const { has, loading, load } = more;
  useEffect(() => {
    const el = ref.current;
    if (!has || !el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((e) => e.some((x) => x.isIntersecting) && void load(), {
      rootMargin: "300px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [has, load]);
  if (!has) return null;
  return (
    <>
      {loading && (
        <div className="card post skeleton" data-testid="feed-skeleton" aria-hidden="true" />
      )}
      <Button
        variant="link"
        ref={ref}
        data-testid="feed-more"
        disabled={loading}
        aria-busy={loading}
        onClick={() => void load()}
      >
        {t("community.feed.more")}
      </Button>
    </>
  );
}

function FeedBody({
  data,
  error,
  mods,
  more,
  stale = false,
}: {
  data: FeedResponse | null;
  error: string | null;
  stale?: boolean;
  more: MoreFeed;
  mods?: ReadonlyMap<string, ModerationItem> | undefined;
}) {
  const cards = usePeopleCards(
    (data?.items ?? []).flatMap((p) => (p.authorUserId ? [p.authorUserId] : [])),
  );
  return (
    <div className="feedbody" data-stale={stale ? "true" : undefined} aria-busy={stale}>
      {error && (
        <div className="card empty" role="alert">
          {error}
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="card empty">{t("community.feed.empty")}</div>
      )}
      {data?.items.map((p) => (
        <PostCard
          key={p.id}
          post={p}
          mod={mods?.get(p.id)}
          avatar={p.authorUserId ? cards.get(p.authorUserId)?.avatar : null}
        />
      ))}
      <FeedMore more={more} />
    </div>
  );
}

/** Danh sách bài + chip lọc + ô lọc gọn (dùng ở Hồ sơ). */
export function FeedList({
  fixed = {},
  tabs = TABS.map((t) => t.id),
  withFilters = true,
  mods,
}: Props) {
  const f = useFeedFilters(fixed);
  const { data, error, stale, more } = useFeed(f.query);
  return (
    <>
      <fieldset className="chips" aria-label={t("community.feed.filterAria")}>
        {TABS.filter((t) => tabs.includes(t.id)).map((t) => (
          <button
            key={t.id}
            type="button"
            className={f.tab === t.id ? "chip on" : "chip"}
            aria-pressed={f.tab === t.id}
            onClick={() => f.setTab(t.id)}
          >
            {tabLabel(t.id)} <span className="n">{data ? (data.counts[t.id] ?? 0) : "–"}</span>
          </button>
        ))}
      </fieldset>
      {withFilters && data && <FeedFilters f={f} data={data} className="selrow" />}
      <FeedBody data={data} error={error} mods={mods} more={more} stale={stale} />
    </>
  );
}

/** CR-191 · bảng tin MỘT cột (kiểu Facebook): ô đăng bài + thanh dính có nút «Lọc», bài gộp công ty mình + đối tác, tải 20 bài/lần khi cuộn. */
export function FeedPage() {
  const f = useFeedFilters();
  const { data, error, stale, more } = useFeed(f.query);
  const connected = useConnected();
  useFocusPost(!!data);
  const { sentinel, stuck, toTop } = useStuck();
  const narrow = useNarrow();
  return (
    <div className="feedwrap">
      <div className="feedcol">
        <div ref={sentinel} className="stickysentinel" aria-hidden="true" />
        <div className="stickytop" data-stuck={stuck}>
          <Composer compact={composerCompact(stuck, narrow)} onExpand={toTop} />
          <div className="feedbar">
            {!narrow && <FeedFilterSheet f={f} data={data} connected={connected} narrow={false} />}
          </div>
        </div>
        <FeedBody data={data} error={error} more={more} stale={stale} />
      </div>
      {narrow && <FeedFilterSheet f={f} data={data} connected={connected} narrow />}
    </div>
  );
}
