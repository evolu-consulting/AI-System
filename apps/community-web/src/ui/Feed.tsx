// Danh sách bài + chip lọc (mockup `.chips`): Cần bán / Cần mua / Thông báo / Đã lưu trữ, nhóm hàng, khu vực, người đăng, tìm kiếm.
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { hasActiveFilter } from "../lib/filters";
import { Composer } from "./Composer";
import { useApp } from "./ctx";
import { PostCard } from "./PostCard";

const TABS: { id: FeedTab; label: string }[] = [
  { id: "all", label: "Tất cả" },
  { id: "sell", label: "Cần bán" },
  { id: "buy", label: "Cần mua" },
  { id: "note", label: "Thông báo" },
  { id: "archived", label: "Đã lưu trữ" },
];

type Props = {
  fixed?: Pick<FeedQuery, "mine" | "authorOrgId">;
  tabs?: FeedTab[];
  withFilters?: boolean;
};

export function FeedList({ fixed = {}, tabs = TABS.map((t) => t.id), withFilters = true }: Props) {
  const { api, rev, search, isHostViewer } = useApp();
  const [tab, setTab] = useState<FeedTab>("all");
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [author, setAuthor] = useState("");
  const [data, setData] = useState<FeedResponse | null>(null);
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isHostViewer) api.listPartners().then(setPartners, () => undefined);
  }, [api, isHostViewer]);
  const query: FeedQuery = {
    tab,
    ...fixed,
    ...(cat ? { cat } : {}),
    ...(area ? { area } : {}),
    ...(author && !fixed.authorOrgId ? { authorOrgId: author } : {}),
    ...(search ? { q: search } : {}),
  };
  const key = JSON.stringify(query);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi bộ lọc hoặc dữ liệu đổi
  useEffect(() => {
    let live = true;
    api.listFeed(query).then(
      (r) => live && (setData(r), setError(null)),
      (e) => live && setError(e instanceof Error ? e.message : "Lỗi tải bảng tin"),
    );
    return () => {
      live = false;
    };
  }, [api, key, rev]);

  const clear = () => {
    setCat("");
    setArea("");
    setAuthor("");
  };
  return (
    <>
      <fieldset className="chips" aria-label="Lọc bài đăng">
        {TABS.filter((t) => tabs.includes(t.id)).map((t) => (
          <button
            key={t.id}
            type="button"
            className={tab === t.id ? "chip on" : "chip"}
            aria-pressed={tab === t.id}
            onClick={() => setTab(t.id)}
          >
            {t.label} <span className="n">{data?.counts[t.id] ?? 0}</span>
          </button>
        ))}
      </fieldset>
      {withFilters && data && (
        <div className="selrow">
          <select
            className="field"
            aria-label="Nhóm hàng"
            value={cat}
            onChange={(e) => setCat(e.target.value)}
          >
            <option value="">Nhóm hàng: tất cả</option>
            {data.facets.cats.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
          <select
            className="field"
            aria-label="Khu vực"
            value={area}
            onChange={(e) => setArea(e.target.value)}
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
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
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
          {hasActiveFilter({ tab, cat, area, authorOrgId: author }) && (
            <button type="button" className="linkbtn" onClick={clear}>
              Xoá lọc
            </button>
          )}
        </div>
      )}
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

export function FeedPage() {
  return (
    <div className="page">
      <div className="feedgrid">
        <Composer />
        <FeedList />
      </div>
    </div>
  );
}
