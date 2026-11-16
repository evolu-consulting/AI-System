import { describe, expect, test } from "bun:test";
import { avatarNameOf, metaLineOf } from "./row-view";

const peer = (job_title: string | null) => ({
  id: "00000000-0000-4000-8000-000000000001",
  name: "Dung Dang",
  active: true,
  job_title,
});
const company = { id: "00000000-0000-4000-8000-000000000002", name: "Công ty preschool" };

describe("CR-179 · dòng danh sách hội thoại", () => {
  test("avatar lấy tên người, không lấy tên công ty", () => {
    expect(avatarNameOf("Dung Dang")).toBe("Dung Dang");
  });
  test("partner đủ công ty + chức vụ", () => {
    expect(metaLineOf({ kind: "partner", company, peer: peer("Giám đốc") })).toEqual({
      company: "Công ty preschool",
      job: "Giám đốc",
    });
  });
  test("thiếu chức vụ ⇒ chỉ công ty", () => {
    expect(metaLineOf({ kind: "partner", company, peer: peer(null) })).toEqual({
      company: "Công ty preschool",
      job: "",
    });
  });
  test("thiếu công ty (nội bộ) ⇒ chỉ chức vụ", () => {
    expect(metaLineOf({ kind: "direct", company: null, peer: peer("Kế toán") })).toEqual({
      company: "",
      job: "Kế toán",
    });
  });
  test("thiếu cả hai / nhóm ⇒ không có dòng 2", () => {
    expect(metaLineOf({ kind: "direct", company: null, peer: peer(null) })).toBeNull();
    expect(metaLineOf({ kind: "group", company: null, peer: null })).toBeNull();
    expect(metaLineOf(null)).toBeNull();
  });
});
