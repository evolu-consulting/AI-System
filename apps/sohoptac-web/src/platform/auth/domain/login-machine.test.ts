// CR-118 · cr118-auth · máy trạng thái login gộp (password → change → TOTP → home theo vai) + quyền mở path + dội SSO.
import { describe, expect, test } from "bun:test";
import type { LoginResponse, Me } from "@ai/contracts/chat";
import { bouncesToSso, canOpen, capsOf, homeFor, landing, moduleOf, stepOf } from "./login-machine";

const member = { id: "u1", kind: "internal" } as unknown as Me;
const partner = { id: "u2", kind: "external" } as unknown as Me;
const legacy = { id: "u3" } as unknown as Me; // server cũ: không có `kind` ⇒ nội bộ
const grant = (user: Me) => ({ status: "authenticated", user }) as unknown as LoginResponse;
const change = { status: "password_change_required", change_token: "c1" } as LoginResponse;
const totp = { status: "totp_required", totp_token: "t1" } as unknown as LoginResponse;

describe("CR-118 · password → change → TOTP → home theo vai", () => {
  test("mỗi trả lời của admin-api ⇒ đúng bước kế", () => {
    expect(stepOf(change)).toEqual({ kind: "change", token: "c1" });
    expect(stepOf(totp)).toEqual({ kind: "totp", token: "t1" });
    expect(stepOf(grant(member))).toEqual({ kind: "done", user: member });
  });

  test("đối tác lần đầu: đổi mật khẩu ⇒ phiên ⇒ /community", () => {
    const s1 = stepOf(change);
    expect(s1.kind).toBe("change");
    const s2 = stepOf(grant(partner));
    if (s2.kind !== "done") throw new Error("phải xong");
    expect(landing(capsOf(s2.user, null), undefined)).toBe("/community");
  });

  test("thành viên có 2FA: TOTP ⇒ phiên ⇒ /overview; next nội bộ được giữ", () => {
    expect(stepOf(totp).kind).toBe("totp");
    const caps = capsOf(member, null);
    expect(landing(caps, undefined)).toBe("/overview");
    expect(landing(caps, "/partners?tab=a")).toBe("/partners?tab=a");
    expect(landing(caps, "/community/profile/o1/info")).toBe("/community/profile/o1/info");
  });

  test("next không mở được / không an toàn ⇒ home", () => {
    const p = capsOf(partner, null);
    expect(landing(p, "/contracts/abc")).toBe("/community");
    expect(landing(capsOf(member, null), "//evil.com")).toBe("/overview");
    expect(landing(capsOf(member, null), "/login?next=/x")).toBe("/overview");
  });
});

describe("CR-118 · capsOf / homeFor (FeatureGate apps khi có, không thì theo me.kind)", () => {
  test("đối tác: không bao giờ có SHT, kể cả khi apps (lỗi) ghi contracts", () => {
    expect(capsOf(partner, null)).toEqual({ contracts: false, community: true });
    expect(capsOf(partner, ["contracts", "community"])).toEqual({
      contracts: false,
      community: true,
    });
  });
  test("nội bộ: theo apps của /pack/me; chưa có ⇒ cả hai (server vẫn là nguồn thật)", () => {
    expect(capsOf(member, null)).toEqual({ contracts: true, community: true });
    expect(capsOf(legacy, null)).toEqual({ contracts: true, community: true });
    expect(capsOf(member, ["community"])).toEqual({ contracts: false, community: true });
    expect(capsOf(member, ["contracts"])).toEqual({ contracts: true, community: false });
  });
  test("home: có SHT ⇒ /overview, chỉ community ⇒ /community", () => {
    expect(homeFor({ contracts: true, community: true })).toBe("/overview");
    expect(homeFor({ contracts: false, community: true })).toBe("/community");
    expect(homeFor({ contracts: true, community: false })).toBe("/overview");
  });
});

describe("CR-118 · moduleOf / canOpen (đối tác cách ly ở mức route)", () => {
  test("phân path theo module (bỏ query/hash)", () => {
    expect(moduleOf("/community")).toBe("community");
    expect(moduleOf("/community?settings=1")).toBe("community");
    expect(moduleOf("/community/profile/o/s")).toBe("community");
    expect(moduleOf("/communityx")).toBe("contracts");
    expect(moduleOf("/overview")).toBe("contracts");
    expect(moduleOf("/contracts/1#x")).toBe("contracts");
    for (const p of ["/", "/login", "/sso", "/privacy", "/terms", "/login?next=/a"])
      expect(moduleOf(p)).toBe("public");
  });
  test("đối tác: mở /community, không mở path SHT", () => {
    const p = capsOf(partner, null);
    expect(canOpen("/community", p)).toBe(true);
    for (const path of ["/overview", "/contracts", "/partners", "/settings/members", "/products"])
      expect(canOpen(path, p)).toBe(false);
    expect(canOpen("/privacy", p)).toBe(true);
  });
  test("công ty tắt Community ⇒ thành viên không mở /community", () => {
    expect(canOpen("/community", capsOf(member, ["contracts"]))).toBe(false);
  });
});

describe("CR-118 · bouncesToSso: /community* không dội sang AI System, SHT giữ dội", () => {
  test("SHT dội; community và trang công khai không", () => {
    expect(bouncesToSso("/overview")).toBe(true);
    expect(bouncesToSso("/contracts/abc?tab=1")).toBe(true);
    expect(bouncesToSso("/community")).toBe(false);
    expect(bouncesToSso("/community/profile/o/s")).toBe(false);
    expect(bouncesToSso("/login")).toBe(false);
  });
});
