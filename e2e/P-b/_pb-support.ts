/// <reference lib="dom" />
// HUB-FR-120…124 · ADM-FR-68/69 · e2e P-b · helper Playwright (test-plan §4.6; nhãn nguyên văn plan-frontend.md §6 + plan-frontend-i18n.md):
// đăng nhập admin-web theo vai (tenant_admin `binh`, platform_admin seed, member `lan`), dựng nguồn + quy trình bằng API Hub THẬT
// (idempotent — 409 coi như đã có), đọc trạng thái run bằng SQL owner. Dùng lại `settle/rtScript/users` của P-a (cùng Runtime giả).
import { randomUUID } from "node:crypto";
import { expect, type Page } from "@playwright/test";
import { PW, USER_ID } from "../../tests/acceptance/M1/_data";
import { chatLogin, hub as hubRaw, token } from "../chat/_x2a-support";
import { withSql } from "../P-a/_pa-support";
import { seedAdmin } from "../support/helpers";
import { ACME, AGENT, DEF, PERSONA, SRC, type Who } from "./_pb-data";

export { rtReset, rtScript, settle, withSql } from "../P-a/_pa-support";
export { ACME, DEF, PERSONA, SRC, type Who } from "./_pb-data";

// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pb.config đặt)
export const ADMIN_URL = process.env.PB_ADMIN_URL ?? "http://localhost:4605";
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.pb.config đặt)
const AUTH = process.env.X2A_API_URL ?? "http://localhost:4601";
// biome-ignore lint/suspicious/noExplicitAny: body JSON theo contract chưa có
export type Json = any;

// ---------- token + gọi Hub ----------
export const tok = (w: Who) => token(PERSONA[w].username);
export async function platformToken(): Promise<string> {
  const a = seedAdmin();
  const r = await fetch(`${AUTH}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenant_key: "platform", username: a.username, password: a.password }),
  });
  expect(r.status, "đăng nhập platform_admin").toBe(200);
  return ((await r.json()) as { access_token: string }).access_token;
}
export const hub = hubRaw;

// ---------- đăng nhập UI ----------
/** admin-web: `tenant_admin` (Adm) hoặc `member` (A) của acme. */
export async function adminLogin(p: Page, who: Who = "Adm"): Promise<void> {
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("acme");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(PERSONA[who].username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(PW);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
/** admin-web: platform_admin seed (tenant `platform`). */
export async function platformLogin(p: Page): Promise<void> {
  const a = seedAdmin();
  await p.goto(`${ADMIN_URL}/login`);
  await p.getByRole("textbox", { name: "Mã công ty" }).fill("platform");
  await p.getByRole("textbox", { name: "Tên đăng nhập" }).fill(a.username);
  await p.getByLabel("Mật khẩu", { exact: true }).fill(a.password);
  await p.getByRole("button", { name: "Đăng nhập", exact: true }).click();
  await p.waitForURL((u) => !u.pathname.startsWith("/login"));
}
export { chatLogin };

// ---------- dựng dữ liệu bằng API ----------
const git = (key: string, url: string, branch: string, description: string) => ({
  key,
  kind: "git_remote",
  config: { kind: "git_remote", url, branch },
  description,
});
/** Nguồn git ed-src-1…6 (editor), `conflict-src` (E-PB07), `new-repo` KHÔNG dựng (tạo bằng UI ở E-PB01). */
export const ED_SOURCES = ["ed-src-1", "ed-src-2", "ed-src-3", "ed-src-4", "ed-src-5", "ed-src-6"];

async function postOk(token: string, path: string, body: unknown): Promise<void> {
  const r = await hub(token, "POST", path, body);
  expect([201, 409], `${path} → ${r.status} ${JSON.stringify(r.json)}`).toContain(r.status);
}

export const stageDef = (o: {
  key: string;
  name: string;
  agentId: string;
  sources?: { source_key: string; allowlist: string[] }[];
}): Json => ({
  key: o.key,
  name: o.name,
  executor: { kind: "agent", agent_id: o.agentId },
  instruction: `Thực hiện ${o.name}.`,
  output: {
    filename: `${o.key}.md`,
    template: "## Kết quả\n",
    required_sections: ["Kết quả"],
    fields: [],
  },
  after: { kind: "auto" },
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 600,
  token_budget: null,
  sources: o.sources ?? [],
  must_know: [],
});
const AGENT_READ: string = AGENT.read;

export async function createDef(
  key: string,
  name: string,
  extra: { sources?: string[]; inputs?: Json[]; stages?: Json[] } = {},
): Promise<{ id: string }> {
  const t = await tok("Adm");
  const body = {
    key,
    name,
    description: `Quy trình e2e P-b ${name}.`,
    input_hint: "Nội dung cần kiểm",
    run_group_ids: [],
    stages: extra.stages ?? [stageDef({ key: "s1", name: "Phân tích", agentId: AGENT_READ })],
    token_budget: null,
    enabled: true,
    sources: extra.sources ?? [],
    inputs: extra.inputs ?? [],
  };
  const r = await hub(t, "POST", "/process-defs", body);
  if (r.status === 201) return { id: r.json.id as string };
  expect(r.status, `POST /process-defs ${key} → ${JSON.stringify(r.json)}`).toBe(409);
  const list = await hub(t, "GET", "/process-defs?kind=sample&limit=100");
  const found = ((list.json?.items ?? []) as Json[]).find((d) => d.key === key);
  expect(found, `${key} có trong GET /process-defs`).toBeTruthy();
  return { id: found.id as string };
}

let seeded: Promise<void> | null = null;
/** Nguồn + quy trình cố định của bộ e2e (idempotent trong cùng DB). */
export function seedPb(): Promise<void> {
  seeded ??= (async () => {
    const adm = await tok("Adm");
    for (const s of [SRC.app, SRC.used, SRC.bad])
      await postOk(adm, "/admin/sources", git(s.key, s.url, s.branch, s.description));
    for (const k of ED_SOURCES)
      await postOk(
        adm,
        "/admin/sources",
        git(k, `https://github.com/pb-test/${k}.git`, "main", `Nguồn soạn ${k}`),
      );
    await postOk(
      adm,
      "/admin/sources",
      git("conflict-src", "https://github.com/pb-test/conflict-src.git", "main", "Nguồn xung đột"),
    );
    // local_path: chỉ platform_admin tạo được, gắn tenant acme.
    const pf = await platformToken();
    await postOk(pf, "/admin/sources", {
      key: SRC.local.key,
      kind: "local_path",
      config: { kind: "local_path", path: SRC.local.path },
      description: SRC.local.description,
      tenant_id: ACME,
    });
    const s1 = (src: string, allow: string[] = ["src/**"]) =>
      stageDef({
        key: "s1",
        name: "Phân tích",
        agentId: AGENT_READ,
        sources: [{ source_key: src, allowlist: allow }],
      });
    await createDef(DEF.run.key, DEF.run.name, {
      sources: [SRC.app.key],
      stages: [s1(SRC.app.key)],
      inputs: [
        { key: "repo", label: DEF.run.inputLabel, type: "source_ref", required: true },
        { key: "ghi-chu", label: DEF.run.textLabel, type: "text", required: false },
      ],
    });
    await createDef(DEF.bad.key, DEF.bad.name, {
      sources: [SRC.bad.key],
      stages: [s1(SRC.bad.key)],
    });
    await createDef(DEF.used.key, DEF.used.name, {
      sources: [SRC.used.key],
      stages: [s1(SRC.used.key)],
    });
  })();
  return seeded;
}

/** Phòng nhóm cho ca chat (Lan chủ phòng, `thu` thành viên). */
export async function mkRoom(name: string): Promise<{ id: string; name: string }> {
  const n = `${name} ${Date.now() % 100000}`;
  const r = await hub(await tok("A"), "POST", "/rooms", {
    kind: "group",
    name: n,
    member_ids: [USER_ID.thu],
  });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return { id: r.json.id as string, name: n };
}

/** Run mới nhất của quy trình `key` (SQL owner). `inputs`/`pinned_sources` là jsonb. */
export async function latestRun(key: string): Promise<{
  id: string;
  flow_id: string;
  status: string;
  inputs: Json;
  pinned: Json;
  decision: Json;
} | null> {
  return withSql(async (sql) => {
    const [r] = await sql<
      {
        id: string;
        flow_id: string;
        status: string;
        inputs: Json;
        pinned: Json;
        decision: Json;
      }[]
    >`select id, flow_id, status, inputs, pinned_sources as pinned, decision from hub.process_runs
      where snapshot->>'key' = ${key} order by started_at desc limit 1`;
    return r ?? null;
  });
}
export const uniqKey = (p: string) => `${p}-${randomUUID().slice(0, 6)}`;
