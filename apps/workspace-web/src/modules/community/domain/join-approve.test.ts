// CR-130 · duyệt yêu cầu tham gia: lọc đối tác, câu lỗi gắn đối tác.
import { describe, expect, test } from "bun:test";
import { approveErrorKey, filterParties } from "./join-approve";

const L = [
  { party: "mst:1", name: "Công ty Đại Phát" },
  { party: "mst:2", name: "Hãng NCCA" },
];

describe("filterParties", () => {
  test("không phân biệt hoa thường/dấu; rỗng ⇒ tất cả; giới hạn", () => {
    expect(filterParties(L, "dai phat").map((p) => p.party)).toEqual(["mst:1"]);
    expect(filterParties(L, "")).toHaveLength(2);
    expect(filterParties(L, "", 1)).toHaveLength(1);
    expect(filterParties(L, "zzz")).toEqual([]);
  });
});

describe("approveErrorKey", () => {
  test("mã gắn đối tác có câu riêng; mã khác ⇒ null", () => {
    expect(approveErrorKey({ status: 409, code: "PARTNER_ALREADY_LINKED" })).toBe(
      "community.flows.join.errLinked",
    );
    expect(approveErrorKey({ status: 422, code: "PARTNER_NOT_FOUND" })).toBe(
      "community.flows.join.errPartyGone",
    );
    expect(approveErrorKey({ status: 409, code: "CONFLICT" })).toBeNull();
    expect(approveErrorKey(null)).toBeNull();
  });
});
