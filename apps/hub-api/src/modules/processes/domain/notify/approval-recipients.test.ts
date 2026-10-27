// approval-inbox · luật chọn người nhận thông báo bước duyệt: assignee ∪ nhóm bước ∪ nhóm chủ (`also_group_ids`), bỏ trùng, loại người thao tác.
import { describe, expect, it } from "bun:test";
import { noticeRecipients } from "./remind.rules";

describe("noticeRecipients · nhóm chủ HĐ", () => {
  const t = { userIds: ["a"], groupMemberIds: ["b", "c"], alsoMemberIds: ["c", "d"] };
  it("gộp assignee, nhóm bước, nhóm chủ; bỏ trùng; giữ thứ tự", () => {
    expect(noticeRecipients(t)).toEqual(["a", "b", "c", "d"]);
  });
  it("loại người vừa thao tác", () => {
    expect(noticeRecipients(t, "d")).toEqual(["a", "b", "c"]);
  });
  it("vắng alsoMemberIds ⇒ hành vi cũ", () => {
    expect(noticeRecipients({ userIds: ["a"], groupMemberIds: ["b"] })).toEqual(["a", "b"]);
  });
  it("head_only: nhóm bước rút còn trưởng phòng nhưng nhóm chủ vẫn nhận", () => {
    expect(
      noticeRecipients({ userIds: [], groupMemberIds: ["head"], alsoMemberIds: ["x"] }),
    ).toEqual(["head", "x"]);
  });
});
