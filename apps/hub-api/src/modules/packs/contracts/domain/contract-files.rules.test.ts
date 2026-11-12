// CR-133 · luật thuần «Tài liệu kèm»: đuôi nhận được, quyền gắn/gỡ, gom hai nhóm.
import { describe, expect, test } from "bun:test";
import {
  acceptedExtensions,
  canAddContractFile,
  canRemoveContractFile,
  groupContractFiles,
  mimeByName,
} from "./contract-files.rules";

const f = { created_by: "creator", owner_user_id: "owner" };
const none = { admin: false, write: false };
const writer = { admin: false, write: true };
const admin = { admin: true, write: true };

describe("CR-133 mimeByName", () => {
  test("docx/xlsx/ảnh nhận, đuôi lạ/không đuôi ⇒ null", () => {
    expect(mimeByName("a.DOCX")).toContain("wordprocessingml");
    expect(mimeByName("b.png")).toBe("image/png");
    expect(mimeByName("c.doc")).toBeNull();
    expect(mimeByName("noext")).toBeNull();
    expect(mimeByName("x.constructor")).toBeNull();
  });
  test("câu lỗi liệt kê định dạng nhận được", () => {
    expect(acceptedExtensions()).toContain("DOCX");
  });
});

describe("CR-133 quyền gắn/gỡ", () => {
  test("gắn: quản trị, hoặc ghi + tạo/phụ trách; người ghi khác ⇒ không", () => {
    expect(canAddContractFile(f, "x", admin)).toBe(true);
    expect(canAddContractFile(f, "creator", writer)).toBe(true);
    expect(canAddContractFile(f, "owner", writer)).toBe(true);
    expect(canAddContractFile(f, "x", writer)).toBe(false);
    expect(canAddContractFile(f, "creator", none)).toBe(false);
  });
  test("gỡ: thêm người đã gắn tệp đó (vẫn cần quyền ghi gói)", () => {
    expect(canRemoveContractFile(f, "x", "x", writer)).toBe(true);
    expect(canRemoveContractFile(f, "y", "x", writer)).toBe(false);
    expect(canRemoveContractFile(f, "x", "x", none)).toBe(false);
    expect(canRemoveContractFile(f, "y", "owner", writer)).toBe(true);
  });
});

describe("CR-133 gom hai nhóm", () => {
  test("hai nhóm trong một khối, can_remove theo từng dòng, size → số", () => {
    const g = groupContractFiles(
      [
        {
          id: "1",
          name: "a.docx",
          mime: "m",
          size_bytes: "10",
          added_by: "u",
          added_at: "2026-11-12T00:00:00Z",
        },
      ],
      [
        {
          id: "2",
          name: "b.pdf",
          mime: "application/pdf",
          size: 5,
          source: "form",
          added_at: new Date(0),
        },
      ],
      (by) => by === "u",
    );
    expect(g.files[0]).toMatchObject({ size: 10, can_remove: true });
    expect(g.steps[0]).toMatchObject({
      id: "2",
      source: "form",
      added_at: "1970-01-01T00:00:00.000Z",
    });
  });
});
