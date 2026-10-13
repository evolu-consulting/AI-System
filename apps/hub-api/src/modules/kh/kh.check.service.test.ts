// HUB-FR-131 · HUB-BR-36 · HUB-BR-40 · plan K1 §3.1, G6 · unit `KhCheckService.probe` với client giả (không DB, không mạng):
// thứ tự bước, dừng sớm, khoá không đọc được ⇒ `kh_key_invalid` (ca int A28 bị chặn bởi CHECK `secrets_ciphertext_ck`).
import { describe, expect, test } from "bun:test";
import type { Db } from "../../lib/db";
import { SecretUseError } from "../secrets/secrets.use";
import type { KhHit } from "./kh.check.rules";
import { KhCheckService } from "./kh.check.service";

type Call = { path: string; key: boolean };
const conn = { id: "c1", baseUrl: "http://localhost:4030", secretId: "s1", version: 1 };
const cfg = { allowedOrigins: ["http://localhost:4030"], timeoutMs: 1000 };

function fake(o: { keyFails?: boolean; versionNoKey?: number; health?: KhHit } = {}) {
  const calls: Call[] = [];
  const client = {
    async hit(_c: unknown, _m: string, path: string, opts: { key?: boolean } = {}): Promise<KhHit> {
      const key = opts.key !== false;
      if (key && o.keyFails) throw new SecretUseError("decrypt_failed");
      calls.push({ path, key });
      if (path === "/health") return o.health ?? { status: 200, body: { model: "BAAI/bge-m3" } };
      if (path === "/version" && !key) return { status: o.versionNoKey ?? 401, body: null };
      if (path === "/version") return { status: 200, body: { version: "v6.4" } };
      return { status: 200, body: { projects: { "proj-a": {} } } };
    },
  };
  const svc = new KhCheckService({
    db: {} as Db,
    audit: { insert: async () => {} },
    client,
    cfg,
    dev: true,
    now: () => new Date("2026-10-13T00:00:00Z"),
  });
  return { svc, calls };
}

describe("KhCheckService.probe", () => {
  test("HUB-FR-131 · đạt: /health, /version không khoá, /version có khoá, /projects", async () => {
    const { svc, calls } = fake();
    const r = await svc.probe(conn, "proj-a");
    expect(r).toMatchObject({ status: "ok", kh_version: "v6.4", projects: ["proj-a"], items: [] });
    expect(calls).toEqual([
      { path: "/health", key: false },
      { path: "/version", key: false },
      { path: "/version", key: true },
      { path: "/projects", key: true },
    ]);
  });
  test("HUB-BR-36 · khoá không đọc được ⇒ kh_key_invalid, không lời gọi có khoá", async () => {
    const { svc, calls } = fake({ keyFails: true });
    const r = await svc.probe(conn, null);
    expect([r.status, r.items.map((i) => i.code)]).toEqual(["error", ["kh_key_invalid"]]);
    expect(calls.every((c) => !c.key)).toBe(true);
  });
  test("HUB-BR-37 · URL ngoài allowlist ⇒ dừng ở bước 1, không gọi KH", async () => {
    const { svc, calls } = fake();
    const r = await svc.probe({ ...conn, baseUrl: "https://evil.example.com" }, null);
    expect(r.items).toEqual([
      { code: "kh_url_not_allowed", level: "error", params: { reason: "not_in_allowlist" } },
    ]);
    expect(calls).toEqual([]);
  });
  test("HUB-BR-40 · G6 · /health timeout ⇒ kh_timeout dừng", async () => {
    const { svc, calls } = fake({ health: "timeout" });
    const r = await svc.probe(conn, null);
    expect(r.items.map((i) => i.code)).toEqual(["kh_timeout"]);
    expect(calls.map((c) => c.path)).toEqual(["/health"]);
  });
});
