// CR-191 · luật «Ai thấy bài» bản web = bản hub = SQL: chạy CÙNG bảng chân trị.
import { describe, expect, test } from "bun:test";
import { TRUTH } from "../../../../../../tests/acceptance/com-c3/_support/audience-truth";
import { type AudienceViewer, audienceSees } from "./audience-sees";

const toWeb = (v: (typeof TRUTH)[number]["viewer"]): AudienceViewer =>
  v.kind === "partner" ? { kind: "partner", orgId: v.org, labels: v.labels, cats: v.cats } : v;

describe("CR-191 audienceSees (web) · bảng chân trị dùng chung", () => {
  test.each(TRUTH.map((r) => [r.name, r] as const))("%s", (_n, r) => {
    expect(audienceSees(r.aud, r.type, r.postCats, toWeb(r.viewer))).toBe(r.want);
  });
});
