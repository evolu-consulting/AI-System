// dify-workflows · unit link Dify console theo loại app; gốc rỗng ⇒ không link; không lộ app-key.
import { describe, expect, test } from "bun:test";
import { difyEditorUrl, difyLogsUrl, normalizeConsoleBase } from "./workflows.links";

const ID = "0b9f2c1e-1111-4222-8333-444455556666";

describe("dify-workflows · difyEditorUrl", () => {
  test("workflow → /workflow; chat và agent → /configuration", () => {
    expect(difyEditorUrl("https://dify.example.com", ID, "workflow")).toBe(
      `https://dify.example.com/app/${ID}/workflow`,
    );
    expect(difyEditorUrl("https://dify.example.com", ID, "chat")).toBe(
      `https://dify.example.com/app/${ID}/configuration`,
    );
    expect(difyEditorUrl("https://dify.example.com", ID, "agent")).toBe(
      `https://dify.example.com/app/${ID}/configuration`,
    );
  });

  test("bỏ dấu / cuối và khoảng trắng của gốc", () => {
    expect(difyEditorUrl("  https://d.test/x//  ", ID, "workflow")).toBe(
      `https://d.test/x/app/${ID}/workflow`,
    );
  });

  test("gốc rỗng / vắng / không phải http(s) hoặc thiếu / sai mã app ⇒ null (nút ẩn)", () => {
    for (const b of ["", "   ", undefined, null, "ftp://d.test", "javascript:alert(1)"])
      expect(difyEditorUrl(b, ID, "workflow")).toBeNull();
    expect(difyEditorUrl("https://d.test", null, "workflow")).toBeNull();
    expect(difyEditorUrl("https://d.test", "", "chat")).toBeNull();
    expect(difyEditorUrl("https://d.test", "a/../b", "chat")).toBeNull();
  });
});

describe("dify-workflows · difyLogsUrl", () => {
  test("→ /app/<id>/logs; thiếu gốc ⇒ null", () => {
    expect(difyLogsUrl("https://d.test/", ID)).toBe(`https://d.test/app/${ID}/logs`);
    expect(difyLogsUrl("", ID)).toBeNull();
    expect(normalizeConsoleBase("http://localhost:3001")).toBe("http://localhost:3001");
  });
});
