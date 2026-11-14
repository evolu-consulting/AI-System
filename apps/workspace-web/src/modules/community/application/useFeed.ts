// Hook nạp bảng tin: `useFeedFilters` giữ state lọc (tab, nhóm hàng, khu vực, người đăng), `useFeed` nạp bài + facets.
// FeedList (Profile) và FeedPage (2 cột) dùng chung để chia state giữa thanh tab và bộ lọc.
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../i18n";
import { useApp } from "./ctx";

export function useFeedFilters(
  fixed: Pick<FeedQuery, "mine" | "authorOrgId" | "authorUserId"> = {},
) {
  const { search } = useApp();
  const [tab, setTab] = useState<FeedTab>("all");
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [author, setAuthor] = useState("");
  const query: FeedQuery = {
    tab,
    ...fixed,
    ...(cat ? { cat } : {}),
    ...(area ? { area } : {}),
    ...(author && !fixed.authorOrgId ? { authorOrgId: author } : {}),
    ...(search ? { q: search } : {}),
  };
  const clear = () => {
    setCat("");
    setArea("");
    setAuthor("");
  };
  return { tab, setTab, cat, setCat, area, setArea, author, setAuthor, query, clear };
}

/** Gộp trang đầu mới nạp (sau khi dữ liệu đổi) vào danh sách đã tải dần: bài trong cửa sổ trang đầu lấy bản mới, bài đã tải ở trang sau giữ nguyên. */
export function mergeFirstPage(old: FeedResponse, fresh: FeedResponse): FeedResponse {
  const ids = new Set(fresh.items.map((p) => p.id));
  const tail = old.items.slice(fresh.items.length).filter((p) => !ids.has(p.id));
  const next = tail.length > 0 ? old.nextCursor : fresh.nextCursor;
  const { nextCursor: _drop, ...rest } = fresh;
  return { ...rest, items: [...fresh.items, ...tail], ...(next ? { nextCursor: next } : {}) };
}

/** CR-147c · nạp trang đầu (20 bài) rồi tải dần theo `nextCursor` (gọi `more.load` khi cuộn tới cuối). Đổi bộ lọc ⇒ về trang đầu. */
export function useFeed(query: FeedQuery) {
  const { api, rev } = useApp();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = JSON.stringify(query);
  const keyRef = useRef(key);
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi bộ lọc hoặc dữ liệu đổi
  useEffect(() => {
    let live = true;
    const sameQuery = keyRef.current === key;
    keyRef.current = key;
    api.listFeed(query).then(
      (r) => {
        if (!live) return;
        setData((old) => (old && sameQuery ? mergeFirstPage(old, r) : r));
        setError(null);
      },
      (e) => live && setError(e instanceof Error ? e.message : t("community.feed.loadError")),
    );
    return () => {
      live = false;
    };
  }, [api, key, rev]);
  const cursor = data?.nextCursor;
  const load = useCallback(async () => {
    if (!cursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const r = await api.listFeed({ ...query, cursor });
      setData((old) => {
        if (!old) return r;
        const have = new Set(old.items.map((p) => p.id));
        const { nextCursor: _d, ...rest } = old;
        return {
          ...rest,
          items: [...old.items, ...r.items.filter((p) => !have.has(p.id))],
          ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}),
        };
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("community.feed.loadError"));
    } finally {
      setLoadingMore(false);
    }
  }, [api, query, cursor, loadingMore]);
  return { data, error, more: { has: !!cursor, loading: loadingMore, load } };
}

/** Danh sách công ty: chủ quản thấy tất cả đối tác; đối tác thấy công ty của mình. */
export function usePartners(enabled = true): PartnerOrg[] {
  const { api } = useApp();
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  useEffect(() => {
    if (enabled) api.listPartners().then(setPartners, () => undefined);
  }, [api, enabled]);
  return partners;
}
