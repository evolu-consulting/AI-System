import { describe, expect, it } from "bun:test";
import type { Access } from "./community-access";
import { withConnected } from "./post.service";
import type { FeedFilter } from "./post.sql";

const host = { org: null } as unknown as Access;
const f: FeedFilter = {
  org: null,
  tab: "all",
  cat: null,
  area: null,
  author: null,
  authorUser: null,
  q: null,
  mine: false,
  cursor: null,
  limit: 20,
};

describe("CR-191 withConnected", () => {
  it("authorOrgId không phải uuid ⇒ không gọi phần bài công ty kết nối", () => {
    expect(withConnected(host, { ...f, author: "abc" })).toBe(false);
    expect(withConnected(host, { ...f, author: "00000000-0000-4000-8000-0000000000a1" })).toBe(
      true,
    );
    expect(withConnected(host, f)).toBe(true);
    expect(withConnected(host, { ...f, author: "host" })).toBe(false);
    expect(withConnected({ org: "x" } as unknown as Access, f)).toBe(false);
  });
});
