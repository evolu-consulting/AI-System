import { describe, expect, it } from "bun:test";
import {
  activeFilterCount,
  isPartnerPost,
  sourceCount,
  sourceKey,
  sourceQuery,
  typeCount,
} from "./feed-source";

const counts = { all: 7, sell: 3, buy: 2, note: 2, archived: 1 };

describe("CR-191 lọc nguồn bảng tin gộp", () => {
  it("nguồn ⇒ query: tất cả không gửi gì, mình/đối tác gửi source, một công ty gửi authorOrgId", () => {
    expect(sourceQuery("")).toEqual({});
    expect(sourceQuery("own")).toEqual({ source: "own" });
    expect(sourceQuery("connected")).toEqual({ source: "connected" });
    expect(sourceQuery("abc-uuid")).toEqual({ authorOrgId: "abc-uuid" });
  });
  it("đếm: chỉ «Công ty mình» có số theo tab, nguồn đối tác và «Tất cả» ẩn số", () => {
    expect(sourceCount(counts, "sell", "own")).toBe(3);
    expect(sourceCount(counts, "all", "connected")).toBeNull();
    expect(sourceCount(counts, "all", "")).toBeNull();
    expect(sourceCount(undefined, "all", "own")).toBeNull();
    expect(typeCount(counts, "buy", "own")).toBe(2);
    expect(typeCount(counts, "buy", "")).toBeNull();
  });
  it("đếm số lọc đang bật: loại ≠ Tất cả, nhóm hàng, khu vực, nguồn", () => {
    expect(activeFilterCount({ tab: "all", cat: "", area: "", source: "" })).toBe(0);
    expect(activeFilterCount({ tab: "sell", cat: "x", area: "", source: "own" })).toBe(3);
  });
  it("nhãn nguồn: bài kết nối = Đối tác, còn lại (kể cả vắng source) = Công ty mình", () => {
    expect(sourceKey({ source: "connected" })).toBe("connected");
    expect(sourceKey({ source: "own" })).toBe("own");
    expect(sourceKey({})).toBe("own");
    expect(isPartnerPost({ source: "connected" })).toBe(true);
  });
});
