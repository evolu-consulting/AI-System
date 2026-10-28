// C6 · unit logic thuần luồng bình luận + mock sửa/xoá/ẩn.
import { describe, expect, test } from "bun:test";
import type { PartnerOrg, PostView } from "@ai/contracts/community";
import { commentActions, startablePartners } from "./thread";

const org = (id: string, labels: PartnerOrg["labels"]): PartnerOrg =>
  ({ id, name: id, labels, cats: [], left: false }) as PartnerOrg;
const post = (o: Partial<PostView>): PostView =>
  ({
    id: "p",
    type: "sell",
    authorSide: "host",
    cats: [],
    audience: { mode: "buyers" },
    ...o,
  }) as PostView;

describe("commentActions", () => {
  test("người viết sửa/xoá; chỉ chủ quản ẩn và chỉ trên bài chủ quản", () => {
    expect(commentActions({ mine: true }, { isHost: false, postByHost: true })).toEqual({
      edit: true,
      delete: true,
      hide: false,
    });
    expect(commentActions({ mine: false }, { isHost: true, postByHost: true })).toEqual({
      edit: false,
      delete: false,
      hide: true,
    });
    expect(commentActions({ mine: false }, { isHost: true, postByHost: false }).hide).toBe(false);
  });
});

describe("startablePartners", () => {
  const partners = [org("b1", ["buyer"]), org("s1", ["supplier"]), org("b2", ["buyer"])];
  test("chỉ công ty trong audience và chưa có luồng", () => {
    expect(startablePartners(post({}), partners, [{ orgId: "b2" }]).map((p) => p.id)).toEqual([
      "b1",
    ]);
  });
  test("bài đối tác: không có Nhắn riêng", () => {
    expect(startablePartners(post({ authorSide: "partner" }), partners, [])).toEqual([]);
  });
});
