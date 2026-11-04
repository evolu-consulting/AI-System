// Bảng tin: FeedPage (2 cột: composer + thanh tab sticky + bài | rail lọc/đối tác) và FeedList (Profile: chip + lọc gọn).
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { useApp } from "../application/ctx";
import { useFeed, useFeedFilters, usePartners } from "../application/useFeed";
import { hasActiveFilter } from "../domain/filters";
import { t } from "../i18n";
import { Composer } from "./Composer";
import { FeedRail } from "./FeedRail";
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
  fixed?: Pick<FeedQuery, "mine" | "authorOrgId">;
  tabs?: FeedTab[];
  withFilters?: boolean;
};

/** Ba ô chọn nhóm hàng / khu vực / người đăng + nút Xoá lọc. */
export function FeedFilters({
  f,
  data,
  partners,
  className,
}: {
  f: Filters;
  data: FeedResponse;
  partners: PartnerOrg[];
  className: string;
}) {
  const { isHostViewer } = useApp();
  return (
    <div className={className}>
      <select
        className="field"
        aria-label={t("community.feed.filters.cat")}
        value={f.cat}
        onChange={(e) => f.setCat(e.target.value)}
      >
        <option value="">{t("community.feed.filters.catAll")}</option>
        {data.facets.cats.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select
        className="field"
        aria-label={t("community.feed.filters.area")}
        value={f.area}
        onChange={(e) => f.setArea(e.target.value)}
      >
        <option value="">{t("community.feed.filters.areaAll")}</option>
        {data.facets.areas.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      {isHostViewer && (
        <select
          className="field"
          aria-label={t("community.feed.filters.author")}
          value={f.author}
          onChange={(e) => f.setAuthor(e.target.value)}
        >
          <option value="">{t("community.feed.filters.authorAll")}</option>
          <option value="host">{t("community.feed.filters.host")}</option>
          {partners.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      )}
      {hasActiveFilter({
        tab: f.tab,
        cat: f.cat,
        area: f.area,
        authorOrgId: f.author,
      }) && (
        <button type="button" className="linkbtn" onClick={f.clear}>
          {t("community.feed.filters.clear")}
        </button>
      )}
    </div>
  );
}

function FeedBody({ data, error }: { data: FeedResponse | null; error: string | null }) {
  return (
    <>
      {error && (
        <div className="card empty" role="alert">
          {error}
        </div>
      )}
      {data && data.items.length === 0 && (
        <div className="card empty">{t("community.feed.empty")}</div>
      )}
      {data?.items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
    </>
  );
}

/** Danh sách bài + chip lọc + ô lọc gọn (dùng ở Hồ sơ). */
export function FeedList({ fixed = {}, tabs = TABS.map((t) => t.id), withFilters = true }: Props) {
  const { isHostViewer } = useApp();
  const f = useFeedFilters(fixed);
  const { data, error } = useFeed(f.query);
  const partners = usePartners(isHostViewer);
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
            {tabLabel(t.id)} <span className="n">{data?.counts[t.id] ?? 0}</span>
          </button>
        ))}
      </fieldset>
      {withFilters && data && (
        <FeedFilters f={f} data={data} partners={partners} className="selrow" />
      )}
      <FeedBody data={data} error={error} />
    </>
  );
}

export function FeedPage() {
  const f = useFeedFilters();
  const { data, error } = useFeed(f.query);
  const partners = usePartners();
  return (
    <div className="feedwrap">
      <div className="feedcol">
        <div className="stickytop">
          <Composer />
          <div className="feedbar">
            <div className="tabs" role="tablist" aria-label={t("community.feed.filterAria")}>
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={f.tab === t.id}
                  className={f.tab === t.id ? "tab on" : "tab"}
                  onClick={() => f.setTab(t.id)}
                >
                  {tabLabel(t.id)} <span className="n">{data?.counts[t.id] ?? 0}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
        <FeedBody data={data} error={error} />
      </div>
      <FeedRail
        filters={
          data ? <FeedFilters f={f} data={data} partners={partners} className="rfilter" /> : null
        }
        partners={partners}
      />
    </div>
  );
}
