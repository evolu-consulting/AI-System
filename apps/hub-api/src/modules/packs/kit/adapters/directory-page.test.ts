// fix-review-r1 · con trỏ danh bạ với tên phòng + tên người DÀI NHẤT (64 ký tự tiếng Việt 3 byte) vẫn vừa trần của contract và đọc lại đúng.
import { describe, expect, it } from "bun:test";
import { MSG_PEOPLE_CURSOR_MAX, MsgPeopleQuerySchema } from "@ai/contracts/pack-contracts";
import { decodeDirCursor, encodeDirCursor } from "./directory-page";

const ID = "00000000-0000-4000-8000-000000000001";

describe("con trỏ danh bạ [fix-review-r1]", () => {
  it("tên phòng + tên người dài nhất (3 byte/ký tự, có dấu nháy) ⇒ vẫn qua schema và giải mã đúng", () => {
    const dept = `"${"ệ".repeat(62)}"`;
    const name = `"${"ớ".repeat(62)}"`;
    const c = encodeDirCursor([0, dept, name, ID]);
    expect(c.length).toBeLessThanOrEqual(MSG_PEOPLE_CURSOR_MAX);
    expect(MsgPeopleQuerySchema.safeParse({ cursor: c }).success).toBe(true);
    expect(decodeDirCursor(c)).toEqual([0, dept, name, ID]);
  });
  it("con trỏ ngắn cũ (> 300 ký tự) không còn bị từ chối", () => {
    const c = encodeDirCursor([0, "ệ".repeat(60), "ớ".repeat(60), ID]);
    expect(c.length).toBeGreaterThan(300);
    expect(MsgPeopleQuerySchema.safeParse({ cursor: c }).success).toBe(true);
  });
});
