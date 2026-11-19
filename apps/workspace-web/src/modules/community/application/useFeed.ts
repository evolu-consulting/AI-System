// Hook nạp bảng tin: `useFeedFilters` giữ state lọc (tab, nhóm hàng, khu vực, người đăng), `useFeed` nạp bài + facets.
// FeedList (Profile) và FeedPage (2 cột) dùng chung để chia state giữa thanh tab và bộ lọc.
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { applyFirstPage, feedScopeKey, scopeChange, withoutGone } from "../domain/feed-merge";
import { sourceQuery } from "../domain/feed-source";
import { t } from "../i18n";
import { useApp } from "./ctx";
import type { ConnectedCompany } from "./ports";

export function useFeedFilters(
  fixed: Pick<FeedQuery, "mine" | "authorOrgId" | "authorUserId"> = {},
) {
  const { search } = useApp();
  const [tab, setTab] = useState<FeedTab>("all");
  const [cat, setCat] = useState("");
  const [area, setArea] = useState("");
  const [author, setAuthor] = useState("");
  const [source, setSource] = useState("");
  const query: FeedQuery = {
    tab,
    ...fixed,
    ...(cat ? { cat } : {}),
    ...(area ? { area } : {}),
    ...(author && !fixed.authorOrgId ? { authorOrgId: author } : {}),
    ...(fixed.authorOrgId ? {} : sourceQuery(source)),
    ...(search ? { q: search } : {}),
  };
  const clear = () => {
    setCat("");
    setArea("");
    setAuthor("");
    setSource("");
    setTab("all");
  };
  return {
    tab,
    setTab,
    cat,
    setCat,
    area,
    setArea,
    author,
    setAuthor,
    source,
    setSource,
    query,
    clear,
  };
}

/** Nối trang kế vào danh sách đang có (bỏ bài trùng; con trỏ lấy từ trang mới). */
function appendPage(old: FeedResponse | null, r: FeedResponse): FeedResponse {
  if (!old) return r;
  const have = new Set(old.items.map((p) => p.id));
  const { nextCursor: _d, ...rest } = old;
  return {
    ...rest,
    items: [...old.items, ...r.items.filter((p) => !have.has(p.id))],
    ...(r.nextCursor ? { nextCursor: r.nextCursor } : {}),
  };
}

/** CR-147c · nạp trang đầu (20 bài) rồi tải dần theo `nextCursor` (gọi `more.load` khi cuộn tới cuối). Đổi người xem ⇒ bỏ danh sách cũ; chỉ đổi tab/bộ lọc ⇒ giữ bài cũ + `stale` (UI làm mờ) tới khi có trang đầu mới (CR-187 BR-187-9). */
export function useFeed(query: FeedQuery) {
  const { api, rev, viewer, gone } = useApp();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const key = feedScopeKey(query, viewer);
  const [stale, setStale] = useState(false);
  const viewerKey = `${viewer.userId}|${viewer.orgId}|${viewer.role}`;
  const keyRef = useRef({ key, viewer: viewerKey });
  // biome-ignore lint/correctness/useExhaustiveDependencies: nạp lại khi bộ lọc hoặc dữ liệu đổi
  useEffect(() => {
    let live = true;
    const change = scopeChange(keyRef.current, { key, viewer: viewerKey });
    const sameScope = change === "same";
    keyRef.current = { key, viewer: viewerKey };
    if (change === "reset") setData(null); // đổi người xem: không để bài cũ trên màn
    if (change === "stale") setStale(true); // đổi tab/lọc: giữ bài cũ, làm mờ
    api.listFeed(query).then(
      (r) => {
        if (!live) return;
        setData((old) => applyFirstPage(old, r, sameScope));
        setStale(false);
        setError(null);
      },
      (e) => {
        if (!live) return;
        setStale(false);
        setError(e instanceof Error ? e.message : t("community.feed.loadError"));
      },
    );
    return () => {
      live = false;
    };
  }, [api, key, rev]);
  const cursor = data?.nextCursor;
  const load = useCallback(async () => {
    if (!cursor || loadingMore || stale) return;
    setLoadingMore(true);
    try {
      const r = await api.listFeed({ ...query, cursor });
      setData((old) => appendPage(old, r));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("community.feed.loadError"));
    } finally {
      setLoadingMore(false);
    }
  }, [api, query, cursor, loadingMore, stale]);
  const shown = useMemo(() => withoutGone(data, gone), [data, gone]);
  return { data: shown, error, stale, more: { has: !!cursor, loading: loadingMore, load } };
}

/** CR-191 · công ty đã kết nối (cho bộ lọc nguồn); lỗi/không đủ quyền ⇒ rỗng. */
export function useConnected(enabled = true): ConnectedCompany[] {
  const { api } = useApp();
  const [list, setList] = useState<ConnectedCompany[]>([]);
  useEffect(() => {
    if (enabled) api.listConnected().then(setList, () => undefined);
  }, [api, enabled]);
  return list;
}

/** Danh sách công ty: chủ quản thấy tất cả đối tác; đối tác thấy công ty của mình. */
export function usePartners(enabled = true): PartnerOrg[] {
  const { api } = useApp();
  const [partners, setPartners] = useState<PartnerOrg[]>([]);
  useEffect(() => {
    // CR-151: cột bên chỉ hiện 50 công ty đầu; danh sách đầy đủ ở hồ sơ › Đối tác (Xem thêm).
    if (enabled) api.listPartners({ limit: 50, offset: 0 }).then(setPartners, () => undefined);
  }, [api, enabled]);
  return partners;
}
