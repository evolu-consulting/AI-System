// chat-api-gate · luật thuần chặn API Chat AI theo entitlement `chat-app` của CÔNG TY (cùng luật admin-api `TENANT_APP_FEATURES`).
import { describe, expect, it } from "bun:test";
import {
  CHAT_APP_FEATURE,
  CHAT_GATED_PREFIXES,
  type ChatGateCatalog,
  chatAppAllowed,
  chatGateVerdict,
  chatRouteKind,
  dockMessageAllowed,
  isDockSurface,
} from "./chat-gate.rules";

const T1 = "t1";
const T2 = "t2";
const cat = (o: Partial<ChatGateCatalog> = {}): ChatGateCatalog => ({
  features: [
    { id: "f-chat", key: CHAT_APP_FEATURE, status: "on" },
    { id: "f-x", key: "contracts-read", status: "on" },
  ],
  entitled: new Set([`${T1}:f-chat`, `${T2}:f-x`]),
  ...o,
});
const member = (tenantId: string) => ({ tenantId, role: "member" as const });

describe("chatAppAllowed", () => {
  it("tenant có entitlement còn hiệu lực ⇒ được; bị thu hồi ⇒ không", () => {
    expect(chatAppAllowed(cat(), member(T1))).toBe(true);
    expect(chatAppAllowed(cat(), member(T2))).toBe(false);
  });
  it("tenant_admin của công ty bị thu hồi cũng bị chặn; platform_admin luôn được", () => {
    expect(chatAppAllowed(cat(), { tenantId: T2, role: "tenant_admin" })).toBe(false);
    expect(chatAppAllowed(cat(), { tenantId: T2, role: "platform_admin" })).toBe(true);
  });
  it("feature `chat-app` chưa tồn tại (DB trống/cài mới) ⇒ mở như cũ", () => {
    expect(chatAppAllowed(cat({ features: [] }), member(T2))).toBe(true);
  });
  it("feature `off` ⇒ không ai được (kể cả tenant có entitlement); `beta` coi như bật", () => {
    const off = cat({ features: [{ id: "f-chat", key: CHAT_APP_FEATURE, status: "off" }] });
    expect(chatAppAllowed(off, member(T1))).toBe(false);
    const beta = cat({ features: [{ id: "f-chat", key: CHAT_APP_FEATURE, status: "beta" }] });
    expect(chatAppAllowed(beta, member(T1))).toBe(true);
  });
});

describe("chatRouteKind", () => {
  it("route chat của người dùng cuối ⇒ chat", () => {
    for (const [m, p] of [
      ["GET", "/conversations"],
      ["GET", "/conversations/c1/messages"],
      ["DELETE", "/conversations/c1"],
      ["GET", "/runs/r1/events"],
      ["GET", "/runs/r1"],
      ["GET", "/commands"],
      ["GET", "/agents"],
      ["POST", "/attachments"],
      ["GET", "/attachments/a1/content"],
      ["GET", "/rooms"],
      ["POST", "/rooms/r1/messages"],
      ["GET", "/directory"],
      ["GET", "/me/stream"],
    ] as const)
      expect(chatRouteKind(m, p)).toBe("chat");
  });
  it("3 route dock trợ lý Sổ Hợp Tác ⇒ dock", () => {
    expect(chatRouteKind("POST", "/conversations")).toBe("dock");
    expect(chatRouteKind("POST", "/conversations/c1/messages")).toBe("dock");
    expect(chatRouteKind("POST", "/runs/r1/cancel")).toBe("dock");
  });
  it("trace quản trị, gói, Studio, quy trình, MCP/Dify, nội bộ, health ⇒ open", () => {
    for (const [m, p] of [
      ["GET", "/runs/r1/trace"],
      ["GET", "/pack/contracts/me"],
      ["POST", "/pack/contracts/contracts/upload"],
      ["GET", "/studio/api/agents"],
      ["GET", "/agent-grants"],
      ["GET", "/agent-settings"],
      ["GET", "/notifications"],
      ["GET", "/process-runs"],
      ["GET", "/me/review-tasks"],
      ["GET", "/me/process-inbox"],
      ["POST", "/mcp"],
      ["GET", "/internal/jobs/j1/dify-credential"],
      ["GET", "/health"],
      ["GET", "/conversationsx"],
      ["GET", "/menu"],
    ] as const)
      expect(chatRouteKind(m, p)).toBe("open");
  });
  it("mọi tiền tố bị chặn đều phân loại khác open", () => {
    for (const p of CHAT_GATED_PREFIXES) expect(chatRouteKind("GET", p)).not.toBe("open");
  });
});

describe("chatGateVerdict", () => {
  it("open ⇒ cho; có Chat AI ⇒ cho; không Chat AI ⇒ chặn trừ dock được phép", () => {
    expect(chatGateVerdict("open", false, false)).toBe(true);
    expect(chatGateVerdict("chat", true, false)).toBe(true);
    expect(chatGateVerdict("chat", false, true)).toBe(false);
    expect(chatGateVerdict("dock", false, true)).toBe(true);
    expect(chatGateVerdict("dock", false, false)).toBe(false);
  });
  it("dock chỉ nhận văn bản thường không file (chặn @, /, !, file)", () => {
    expect(dockMessageAllowed("Tóm tắt HĐ", 0)).toBe(true);
    expect(dockMessageAllowed("@@không phải tag", 0)).toBe(true);
    expect(dockMessageAllowed("//không phải lệnh", 0)).toBe(true);
    expect(dockMessageAllowed("!!không phải quy trình", 0)).toBe(true);
    expect(dockMessageAllowed("@helper x", 0)).toBe(false);
    expect(dockMessageAllowed("@ x", 0)).toBe(false);
    expect(dockMessageAllowed("/lenh x", 0)).toBe(false);
    expect(dockMessageAllowed("!quy-trinh x", 0)).toBe(false);
    expect(dockMessageAllowed("!", 0)).toBe(false);
    expect(dockMessageAllowed("!!/lenh", 0)).toBe(true);
    expect(dockMessageAllowed("Xem file", 1)).toBe(false);
  });
  it("chỉ header bề mặt `contracts`/`community` mới là dock", () => {
    expect(isDockSurface("contracts")).toBe(true);
    expect(isDockSurface("community")).toBe(true);
    expect(isDockSurface("Community")).toBe(false);
    expect(isDockSurface("chat")).toBe(false);
    expect(isDockSurface(undefined)).toBe(false);
  });
});
