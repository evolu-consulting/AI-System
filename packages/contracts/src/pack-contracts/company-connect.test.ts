// CR-161 · schema zod kết nối hai công ty (spec §3).
import { describe, expect, test } from "bun:test";
import {
  ConnectInviteBodySchema,
  ConnectListQuerySchema,
  ConnectSearchQuerySchema,
} from "./company-connect";
import { MeStreamMsgEventSchema, parseMeStreamMsgEvent } from "./messages";

const U = "00000000-0000-4000-8000-000000000001";

describe("vào", () => {
  test("search: q trim 3..120", () => {
    expect(ConnectSearchQuerySchema.safeParse({ q: " ab " }).success).toBe(false);
    expect(ConnectSearchQuerySchema.parse({ q: "  Preschool " }).q).toBe("Preschool");
    expect(ConnectSearchQuerySchema.safeParse({ q: "a".repeat(121) }).success).toBe(false);
  });
  test("invite: uuid, note trim ≤ 500, khoá lạ bị từ chối", () => {
    expect(ConnectInviteBodySchema.safeParse({ tenant_id: U }).success).toBe(true);
    expect(ConnectInviteBodySchema.parse({ tenant_id: U, note: " hi " }).note).toBe("hi");
    expect(ConnectInviteBodySchema.safeParse({ tenant_id: U, note: "a".repeat(501) }).success).toBe(
      false,
    );
    expect(ConnectInviteBodySchema.safeParse({ tenant_id: "x" }).success).toBe(false);
    expect(ConnectInviteBodySchema.safeParse({ tenant_id: U, x: 1 }).success).toBe(false);
  });
  test("list: limit mặc định 20, 1..50; status giới hạn", () => {
    expect(ConnectListQuerySchema.parse({}).limit).toBe(20);
    expect(ConnectListQuerySchema.parse({ limit: "50" }).limit).toBe(50);
    expect(ConnectListQuerySchema.safeParse({ limit: 51 }).success).toBe(false);
    expect(ConnectListQuerySchema.safeParse({ status: "declined" }).success).toBe(false);
    expect(ConnectListQuerySchema.safeParse({ cursor: "a".repeat(201) }).success).toBe(false);
  });
});

describe("sự kiện /me/stream", () => {
  test("cc.link nằm trong union MeStreamMsgEvent; cc.msg (CR-161) đã bỏ", () => {
    const ok = (event: string, data: unknown) =>
      MeStreamMsgEventSchema.safeParse({ event, data }).success;
    expect(ok("cc.link", { tenant_id: U, status: "connected" })).toBe(true);
    expect(ok("cc.link", { tenant_id: U, status: "x" })).toBe(false);
    expect(ok("cc.msg", { tenant_id: U, seq: 3 })).toBe(false);
  });
  test("parse chuỗi JSON; khoá thừa ⇒ null", () => {
    expect(
      parseMeStreamMsgEvent("cc.link", JSON.stringify({ tenant_id: U, status: "none" }))?.event,
    ).toBe("cc.link");
    expect(parseMeStreamMsgEvent("cc.link", { tenant_id: U, status: "none", extra: 1 })).toBeNull();
    expect(parseMeStreamMsgEvent("cc.msg", { tenant_id: U, seq: 1 })).toBeNull();
  });
});
