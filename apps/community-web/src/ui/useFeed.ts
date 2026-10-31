// Hook nạp bảng tin: `useFeedFilters` giữ state lọc (tab, nhóm hàng, khu vực, người đăng), `useFeed` nạp bài + facets.
// FeedList (Profile) và FeedPage (2 cột) dùng chung để chia state giữa thanh tab và bộ lọc.
import type { FeedQuery, FeedResponse, FeedTab, PartnerOrg } from "@ai/contracts/community";
import { useEffect, useState } from "react";
import { useApp } from "./ctx";

export function useFeedFilters(fixed: Pick<FeedQuery, "mine" | "authorOrgId"> = {}) {
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

export function useFeed(query: FeedQuery) {
  const { api, rev } = useApp();
  const [data, setData] = useState<FeedResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
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
  return { data, error };
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
