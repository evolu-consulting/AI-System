// HUB-FR-92 · HUB-FR-77 · HUB-H2b-AC-02 (vế `hoa`) · HUB-H2b-AC-13 · H2b-R26 (F3) · test-plan cases §3 H01: hub-dev THẬT
// (`tools/hub-dev`, fixture `ensureContractFixture`: `lan` ∈ `beta-testers` của acme, `hoa` ngoài) — `lan` `GET /agents`
// có agent seed `assistant`; `hoa` `items=[]`. Đăng nhập qua auth thật (`AUTH_URL`), mật khẩu dev của fixture.
// Chạy: bước H01 của `bun run done:h2b` (`needsDev`, `HUB_URL`/`AUTH_URL`, `bunfig.stack.toml`).
import { describe, expect, it } from "bun:test";
import { AgentMenuResponseSchema } from "@ai/contracts/chat";
import {
  AUTH_URL as DEV_AUTH_URL,
  HUB_URL as DEV_HUB_URL,
} from "../../../../tools/hub-dev/src/dev";
import { CONTRACT_USERS, DEV_PASSWORD } from "../../../../tools/hub-dev/src/fixture";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến của bước hub-dev (`done:h2b`), không thuộc task turbo
const HUB = (process.env.HUB_URL?.trim() || DEV_HUB_URL).replace(/\/+$/, "");
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến của bước hub-dev (`done:h2b`), không thuộc task turbo
const AUTH = (process.env.AUTH_URL?.trim() || DEV_AUTH_URL).replace(/\/+$/, "");

async function tokenOf(who: "a" | "b"): Promise<string> {
  const u = CONTRACT_USERS[who];
  const res = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      tenant_key: u.tenant_key,
      username: u.username,
      password: DEV_PASSWORD,
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { status?: string; access_token?: string };
  expect(body.status).toBe("authenticated");
  return String(body.access_token);
}

async function menu(who: "a" | "b"): Promise<string[]> {
  const res = await fetch(`${HUB}/agents`, {
    headers: { authorization: `Bearer ${await tokenOf(who)}` },
  });
  expect(res.status).toBe(200);
  const p = AgentMenuResponseSchema.safeParse(await res.json());
  expect(p.success).toBe(true);
  return p.data?.items.map((i) => i.key) ?? [];
}

describe("H01 · fixture hub-dev R26 [HUB-H2b-AC-02 · H2b-R26]", () => {
  it("HUB-FR-92 · H01 · lan (acme, beta-testers) GET /agents có 'assistant' [H2b-R26]", async () => {
    expect(await menu("a")).toContain("assistant");
  });

  it("HUB-FR-92 · H01 · hoa (acme, ngoài beta-testers) GET /agents → items=[] [HUB-H2b-AC-02 · H2b-R26]", async () => {
    expect(await menu("b")).toEqual([]);
  });
});
