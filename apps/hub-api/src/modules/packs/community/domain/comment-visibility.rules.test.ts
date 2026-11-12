// CR-129 · luật thuần bình luận mở theo bạn bè + nhắc đối tác (HT-40…HT-52).
import { describe, expect, it } from "bun:test";
import { canSeeComment, isFriend, mentionAllowed } from "./comment-visibility.rules";

const S1 = "s1";
const S2 = "s2";
const base = { authorOrg: S1, postAuthorOrg: null, mentions: [] as string[], hidden: false };

describe("isFriend (mạng sao)", () => {
  it.each([
    [null, null, true],
    [null, S1, true],
    [S1, null, true],
    [S1, S1, true],
    [S1, S2, false],
  ])("%p ↔ %p ⇒ %p", (a, b, want) => {
    expect(isFriend(a, b)).toBe(want);
  });
});

describe("canSeeComment", () => {
  it("chủ quản thấy tất cả, kể cả bình luận bị ẩn", () => {
    expect(canSeeComment(null, { ...base, hidden: true })).toBe(true);
    expect(canSeeComment(null, { ...base, authorOrg: S2 })).toBe(true);
  });
  it("đối tác thấy bình luận của công ty mình và của chủ quản", () => {
    expect(canSeeComment(S1, base)).toBe(true);
    expect(canSeeComment(S1, { ...base, authorOrg: null })).toBe(true);
  });
  it("HT-44: S1 thấy câu trả lời của chủ quản cho S2", () => {
    expect(canSeeComment(S1, { ...base, authorOrg: null, mentions: [S2] })).toBe(true);
  });
  it("đối tác không thấy bình luận của đối tác khác", () => {
    expect(canSeeComment(S1, { ...base, authorOrg: S2 })).toBe(false);
  });
  it("bài của chính công ty mình: thấy bình luận của đối tác khác; được nhắc: thấy", () => {
    expect(canSeeComment(S1, { ...base, authorOrg: S2, postAuthorOrg: S1 })).toBe(true);
    expect(canSeeComment(S1, { ...base, authorOrg: S2, mentions: [S1] })).toBe(true);
    expect(canSeeComment(S1, { ...base, authorOrg: S2, mentions: [S2] })).toBe(false);
  });
  it("HT-46: bình luận bị ẩn không thấy, kể cả của chính mình / được nhắc / bài mình", () => {
    const h = { ...base, hidden: true };
    expect(canSeeComment(S1, h)).toBe(false);
    expect(canSeeComment(S1, { ...h, authorOrg: S2, mentions: [S1], postAuthorOrg: S1 })).toBe(
      false,
    );
  });
});

describe("mentionAllowed", () => {
  const active = [S1, S2];
  it("chủ quản nhắc công ty còn hiệu lực", () => {
    expect(mentionAllowed(null, S1, active)).toBe(true);
  });
  it("công ty đã rời / lạ ⇒ không", () => {
    expect(mentionAllowed(null, "gone", active)).toBe(false);
  });
  it("đối tác không nhắc được ai (hôm nay): đối tác khác, chính mình", () => {
    expect(mentionAllowed(S1, S2, active)).toBe(false);
    expect(mentionAllowed(S1, S1, active)).toBe(false);
  });
});
