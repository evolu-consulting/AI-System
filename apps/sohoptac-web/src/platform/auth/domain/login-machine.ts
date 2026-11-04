// CR-118 · cr118-auth · luật thuần của login gộp + guard route (spec CR-118 §2 "Phiên"):
//  · bước kế sau `/auth/login` | `/auth/change-password` | `/auth/totp/verify` (password → change → TOTP → done);
//  · app mở được (`AccessCaps`): đối tác KHÔNG BAO GIỜ có SHT; nội bộ theo `apps` của FeatureGate (`/pack/me`), chưa có ⇒ cả hai
//    (server pack guard / `external-deny` là nguồn thật, đây chỉ ẩn UI);
//  · home theo quyền, path → module, có dội sang AI System không (`/community*` không dội — đối tác không có chat-web).
import type { LoginResponse, Me } from "@ai/contracts/chat";
import { safeNext } from "./next";

export type LoginStep =
  | { kind: "login" }
  | { kind: "change"; token: string }
  | { kind: "totp"; token: string }
  | { kind: "done"; user: Me };

export function stepOf(res: LoginResponse): LoginStep {
  if (res.status === "password_change_required") return { kind: "change", token: res.change_token };
  if (res.status === "totp_required") return { kind: "totp", token: res.totp_token };
  return { kind: "done", user: res.user };
}

export type AccessCaps = { contracts: boolean; community: boolean };
export type WebModule = "contracts" | "community" | "public";

export const HOME_CONTRACTS = "/overview";
export const HOME_COMMUNITY = "/community";

/** `apps` = id manifest module được hiện từ `/pack/me` (null = FeatureGate chưa nối / chưa tải). */
export function capsOf(user: Pick<Me, "kind"> | null, apps: readonly string[] | null): AccessCaps {
  const external = user?.kind === "external";
  if (!apps) return { contracts: !external, community: true };
  return {
    contracts: !external && apps.includes("contracts"),
    community: apps.includes("community"),
  };
}

export function homeFor(caps: AccessCaps): string {
  return caps.contracts || !caps.community ? HOME_CONTRACTS : HOME_COMMUNITY;
}

const PUBLIC = new Set(["/", "/login", "/sso", "/privacy", "/terms"]);

export function moduleOf(href: string): WebModule {
  const path = href.split(/[?#]/, 1)[0] || "/";
  if (PUBLIC.has(path)) return "public";
  if (path === "/community" || path.startsWith("/community/")) return "community";
  return "contracts";
}

export function canOpen(href: string, caps: AccessCaps): boolean {
  const m = moduleOf(href);
  return m === "public" || caps[m];
}

/** Đích sau đăng nhập: `next` nội bộ an toàn VÀ mở được, không thì home theo quyền. */
export function landing(caps: AccessCaps, next: unknown): string {
  const n = safeNext(next);
  return n && n !== "/" && canOpen(n, caps) ? n : homeFor(caps);
}

/** Chưa có phiên: chỉ path SHT thử phiên AI System (như nay); `/community*` + trang công khai ⇒ form đăng nhập của web gộp. */
export function bouncesToSso(href: string): boolean {
  return moduleOf(href) === "contracts";
}
