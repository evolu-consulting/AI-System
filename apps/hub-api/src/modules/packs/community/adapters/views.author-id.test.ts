// CR-191 · BR-191-13 · `authorUserId` (để web lấy ảnh thật qua `GET /people?ids=`): CHỈ người xem nội bộ (chủ quản) nhận; đối tác cộng đồng không nhận.
import { describe, expect, it } from "bun:test";
import type { Access } from "./community-access";
import type { PostRow } from "./post.sql";
import { type Names, postView } from "./views";

const names: Names = { orgName: () => "Cty", orgLeft: () => false };
const row = {
  id: "p1",
  type: "sell",
  author_org: null,
  author_user_id: "u-author",
  author_name: "Lan",
  author_title: null,
  created_at: new Date("2026-11-19T00:00:00Z"),
  expires_at: new Date("2026-12-19T00:00:00Z"),
  edited: false,
  status: "active",
  title: "t",
  body: "b",
  fields: {},
  cats: [],
  media: [],
  comments: 0,
  recent: [],
  actions: [],
} as unknown as PostRow;
const access = (org: string | null): Access =>
  ({
    org,
    who: { tenantId: "t1", userId: "viewer", role: "member" },
    dir: { orgs: [] },
  }) as unknown as Access;

describe("postView · authorUserId", () => {
  it("người xem nội bộ nhận mã người đăng, đối tác cộng đồng không nhận", () => {
    expect(postView(access(null), names, row).authorUserId).toBe("u-author");
    expect(postView(access("org-x"), names, row).authorUserId).toBeUndefined();
  });
});
