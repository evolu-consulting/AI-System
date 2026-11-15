// CR-169 · lát 6 · luật thuần web «Tin nhắn với công ty kết nối»: bộ lọc công ty, loại cuộc theo id, nhãn phụ/tìm cuộc partner, chỉ đọc, tên người gửi.
import { describe, expect, test } from "bun:test";
import type { ConversationSummary } from "@ai/contracts/pack-contracts";
import {
  CHIP_COMPANIES_MAX,
  companyName,
  filterParam,
  isCompanyFilter,
  parseFilter,
  planChips,
} from "./company-filter";
import { filterConversations, partnerSubtitle, previewOf, senderNameFrom } from "./conversations";
import { forgetKinds, isPartnerId, kindOf, rememberKind, rememberKinds } from "./kinds";
import { readOnlyReason } from "./perms";

const OWN = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const U = "33333333-3333-4333-8333-333333333333";
const co = (n: number) => ({ id: `00000000-0000-4000-8000-00000000000${n}`, name: `Cty ${n}` });

const partnerConv = (over: Partial<ConversationSummary> = {}): ConversationSummary => ({
  id: "c1",
  kind: "partner",
  title: null,
  peer: { id: U, name: "Hà", active: true, job_title: "Kế toán trưởng" },
  member_count: 2,
  last_message: {
    seq: 1,
    sender_id: U,
    sender_name: "Hà",
    preview: "chào",
    has_files: false,
    deleted: false,
    at: "2026-01-01T00:00:00.000Z",
  },
  unread: 0,
  last_at: "2026-01-01T00:00:00.000Z",
  company: { id: B, name: "Preschool" },
  read_only: false,
  ...over,
});

describe("CR-169 · bộ lọc công ty", () => {
  test("parseFilter: rỗng/sai ⇒ all; công ty mình ⇒ own; công ty khác ⇒ uuid thường", () => {
    expect(parseFilter(undefined, OWN)).toBe("all");
    expect(parseFilter("xyz", OWN)).toBe("all");
    expect(parseFilter(OWN.toUpperCase(), OWN)).toBe("own");
    expect(parseFilter("own", OWN)).toBe("own");
    expect(parseFilter(B.toUpperCase(), OWN)).toBe(B);
  });
  test("filterParam: all không gửi; own/uuid gửi nguyên", () => {
    expect(filterParam("all")).toBeUndefined();
    expect(filterParam("own")).toBe("own");
    expect(filterParam(B)).toBe(B);
    expect(isCompanyFilter(B)).toBe(true);
    expect(isCompanyFilter("own")).toBe(false);
  });
  test("planChips: ≤ 5 công ty hiện hết; ≥ 6 ⇒ «Công ty khác»; công ty đang chọn không bị giấu", () => {
    const five = [1, 2, 3, 4, 5].map(co);
    expect(planChips(five, "all", false)).toEqual({ chips: five, more: false });
    const seven = [1, 2, 3, 4, 5, 6, 7].map(co);
    const p = planChips(seven, co(7).id, false);
    expect(p.chips).toHaveLength(CHIP_COMPANIES_MAX);
    expect(p.chips.at(-1)).toEqual(co(7));
    expect(p.more).toBe(true);
    expect(planChips(five, "all", true).more).toBe(true);
  });
  test("companyName: chỉ khi lọc một công ty", () => {
    expect(companyName(co(1).id, [co(1)])).toBe("Cty 1");
    expect(companyName("all", [co(1)])).toBe("");
    expect(companyName(co(9).id, [co(1)])).toBe("");
  });
});

describe("CR-169 · loại cuộc theo id (đường API)", () => {
  test("nhớ loại; id lạ chưa biết", () => {
    forgetKinds();
    expect(kindOf("x")).toBeUndefined();
    rememberKind("a", "partner");
    rememberKinds([{ id: "b", kind: "group" }]);
    expect(isPartnerId("a")).toBe(true);
    expect(isPartnerId("b")).toBe(false);
    expect(isPartnerId("zzz")).toBe(false);
  });
});

describe("CR-169 · cuộc partner trong danh sách", () => {
  test("nhãn phụ «Chức vụ · Công ty»; thiếu chức vụ chỉ còn công ty; nội bộ rỗng", () => {
    expect(partnerSubtitle(partnerConv())).toBe("Kế toán trưởng · Preschool");
    expect(
      partnerSubtitle(partnerConv({ peer: { id: U, name: "Hà", active: true, job_title: null } })),
    ).toBe("Preschool");
    expect(partnerSubtitle(partnerConv({ kind: "direct", company: null }))).toBe("");
  });
  test("tìm theo tên, chức vụ hoặc công ty (không dấu)", () => {
    const l = [partnerConv()];
    expect(filterConversations(l, "ha")).toHaveLength(1);
    expect(filterConversations(l, "ke toan")).toHaveLength(1);
    expect(filterConversations(l, "preschool")).toHaveLength(1);
    expect(filterConversations(l, "nguyen")).toHaveLength(0);
  });
  test("xem trước 1-1 partner không ghi tên người kia; tên người gửi lấy từ peer", () => {
    expect(previewOf(partnerConv(), OWN)).toMatchObject({ kind: "other", who: "" });
    const list = { pages: [{ items: [partnerConv()], next_cursor: null }] };
    expect(senderNameFrom(list, undefined, "c1", U)).toBe("Hà");
  });
});

describe("CR-169 · chỉ đọc sau ngắt", () => {
  const base = { kind: "partner", read_only: true } as const;
  test("ngắt kết nối vs người kia hết dùng; không chỉ đọc / không phải partner ⇒ null", () => {
    expect(
      readOnlyReason({ ...base, peer: { id: U, name: "Hà", active: true, job_title: null } }),
    ).toBe("disconnected");
    expect(
      readOnlyReason({ ...base, peer: { id: U, name: "Hà", active: false, job_title: null } }),
    ).toBe("peerGone");
    expect(readOnlyReason({ kind: "partner", read_only: false, peer: null })).toBeNull();
    expect(readOnlyReason({ kind: "direct", read_only: true, peer: null })).toBeNull();
  });
});
