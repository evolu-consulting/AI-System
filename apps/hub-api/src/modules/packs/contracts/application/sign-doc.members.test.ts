// fix-cr181-uat · lỗi 2 · người ký kiểu NHÓM nói đích danh thành viên: «Nguyễn Văn Hùng» / «Hùng, Mai» (chip, nhãn chỗ ký).
import { describe, expect, it } from "bun:test";
import { membersLabel, signerWho } from "@ai/contracts/pack-contracts";
import type { SignFieldRowP } from "./sign-doc.ports";
import { buildSigners, fieldOut } from "./sign-doc.usecase";

const hung = { id: "u1", name: "Nguyễn Văn Hùng" };
const mai = { id: "u2", name: "Trần Thị Mai" };
const grp = { kind: "group" as const, id: "g1", name: "Người ký HĐ", mine: false };
const row: SignFieldRowP = {
  id: "f1",
  file_id: "x",
  side: "A",
  signer_kind: "group",
  signer_ref: "g1",
  label: "Đại diện Người ký HĐ",
  parts: [],
  signed_by: null,
  signed_version_id: null,
};

describe("membersLabel / signerWho", () => {
  it("một người ⇒ tên đầy đủ; nhiều người ⇒ tên riêng cách dấu phẩy", () => {
    expect(membersLabel([hung.name])).toBe("Nguyễn Văn Hùng");
    expect(membersLabel([hung.name, mai.name])).toBe("Hùng, Mai");
    expect(membersLabel([])).toBe("");
  });
  it("nhóm không thành viên ⇒ tên nhóm", () => {
    expect(signerWho({ name: "Đại diện Người ký HĐ" })).toBe("Đại diện Người ký HĐ");
    expect(signerWho({ name: "Đại diện X", members: [hung] })).toBe("Nguyễn Văn Hùng");
  });
});

describe("buildSigners + fieldOut với nhóm có thành viên", () => {
  it("signer nhóm mang members, nhãn chỗ ký = tên người, không còn «Đại diện …»", () => {
    const [s] = buildSigners([{ ...grp, members: [hung, mai] }], null, "me");
    expect(s?.members).toEqual([hung, mai]);
    expect(s?.name).toBe("Đại diện Người ký HĐ");
    expect(fieldOut(row, s ? [s] : []).label).toBe("Hùng, Mai");
  });
  it("nhóm chưa có thành viên ⇒ giữ nhãn đã lưu", () => {
    const [s] = buildSigners([grp], null, "me");
    expect(s?.members).toBeUndefined();
    expect(fieldOut(row, s ? [s] : []).label).toBe("Đại diện Người ký HĐ");
  });
});
