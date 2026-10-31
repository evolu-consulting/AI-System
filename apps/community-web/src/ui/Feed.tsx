// Bảng tin: FeedPage (2 cột: composer + thanh tab sticky + bài | rail lọc/đối tác) và FeedList (Profile: chip + lọc gọn).
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { hasActiveFilter } from "../lib/filters";
import { Composer } from "./Composer";
import { useApp } from "./ctx";
import { FeedRail } from "./FeedRail";
import { PostCard } from "./PostCard";
import { useFeed, useFeedFilters, usePartners } from "./useFeed";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "sell", label: "Cần bán" },
  { id: "buy", label: "Cần mua" },
  { id: "note", label: "Thông báo" },
  { id: "archived", label: "Đã lưu trữ" },
];

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
        aria-label="Nhóm hàng"
        value={f.cat}
        onChange={(e) => f.setCat(e.target.value)}
      >
        <option value="">Nhóm hàng: tất cả</option>
        {data.facets.cats.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      <select
        className="field"
        aria-label="Khu vực"
        value={f.area}
        onChange={(e) => f.setArea(e.target.value)}
      >
        <option value="">Khu vực: tất cả</option>
        {data.facets.areas.map((c) => (
          <option key={c}>{c}</option>
        ))}
      </select>
      {isHostViewer && (
        <select
          className="field"
          aria-label="Người đăng"
          value={f.author}
          onChange={(e) => f.setAuthor(e.target.value)}
        >
          <option value="">Người đăng: tất cả</option>
          <option value="host">Chủ quản</option>
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
          Xoá lọc
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
        <div className="card empty">Không có bài đăng nào trong mục này.</div>
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
      <fieldset className="chips" aria-label="Lọc bài đăng">
        {TABS.filter((t) => tabs.includes(t.id)).map((t) => (
          <button
            key={t.id}
            type="button"
            className={f.tab === t.id ? "chip on" : "chip"}
            aria-pressed={f.tab === t.id}
            onClick={() => f.setTab(t.id)}
          >
            {t.label} <span className="n">{data?.counts[t.id] ?? 0}</span>
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
            <div className="tabs" role="tablist" aria-label="Lọc bài đăng">
              {TABS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={f.tab === t.id}
                  className={f.tab === t.id ? "tab on" : "tab"}
                  onClick={() => f.setTab(t.id)}
                >
                  {t.label} <span className="n">{data?.counts[t.id] ?? 0}</span>
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
