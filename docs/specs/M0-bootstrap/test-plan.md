# Test plan · M0-bootstrap (qc)

Chế độ WRITE · 2026-10-01 · vòng 2 (sau "Vá spec-readiness lần 1", `spec.md` §9). M0 là mốc hạ tầng, không có FR nghiệp vụ: "đúng" = **19 AC** `M0-AC01…M0-AC19` ở `spec.md` §8 (yêu cầu gốc `ADM-NFR-06`, ưu tiên `—` trong `ba-admin.md`). AC18 (e2e smoke) và AC19 (`check:bundle`) nay là AC chính thức của spec §8.
Repo chưa scaffold nên **chưa có file test thật**. Mục 3 ghi nguyên văn nội dung dự kiến; qc tạo file (task Q2) ngay sau khi T0–T3 xong, đỏ vì chưa có code tương ứng, rồi LOCK (Q3) sau Gate.
Nguồn chữ ký/luật: `spec.md` §2 (T-SIZE, T-DEP, T-CLI, T-LOCK, T-TRACE, T-I18N, T-MOCK), §3, §8, §9; `plan.md` (createApp, runMigrations, resetTestDb, createDifyMock/createHubMock, CLI scripts); `plan-frontend.md` §5, §7 (nhãn UI); `tasks.md` (T7, Q2, Q3). Không đọc code implementation.

Thay đổi vòng 2: AC18/AC19 chính thức; `tsconfig.tests.json` ở gốc thay `tests/tsconfig.json` (qc#4); i18n thêm ca "chỉ có một file locale → exit 1" (T-I18N-1); mock Hub `/internal/test-run` body `{command, inputs}`, response có `trace: []`, luật chọn kịch bản T-MOCK-1 (header lạ bị bỏ qua, `Authorization` không dạng Bearer → `unauthorized`, `timeout` chờ rồi mới validate); `trace` theo T-TRACE-2 mới (chỉ tính mã trong path hoặc tên test, bỏ `__fixtures__`) và T-TRACE-4 (giữ nguyên phần mở đầu trước `| FR |`); lệnh `psql` đầy đủ, migrate DB test theo T7; CORS `exposeHeaders`; CI `git fetch origin main:main` (r#7).

## 1. Quy ước

- Tên **mọi** `it`/`test`/`describe` theo quy ước `"<mã> · …"` (T-TRACE-2): `ADM-NFR-06 · M0-ACxx · …` (vd `it("ADM-NFR-06 · M0-AC11 · file code 401 dòng → exit 1")`). Thư mục `tests/acceptance/ADM-NFR-06/` cũng chứa mã trong path nên `trace` tính `ADM-NFR-06` là có test theo cả hai vế (a) và (b).
- **Không** để chuỗi dạng `it("<mã khác>` / `test("<mã khác>` / `describe("<mã khác>` xuất hiện nguyên văn trong mã nguồn test (vd trong dữ liệu mẫu của `trace.test.ts`): nếu có, `trace` trên repo thật sẽ tính nhầm mã đó là có test. Dữ liệu mẫu dựng tên hàm qua biến (`const IT = "it"; \`${IT}("ADM-BR-03 · …")\``). Mã FR chỉ nằm trong chuỗi dữ liệu/comment thì không bị tính (đúng T-TRACE-2).
- Loại: **acceptance** (bun test, in-process hoặc CLI trong repo tạm), **int** (`*.int.test.ts`, cần Postgres, chạy bằng `bun run test:int`), **e2e** (Playwright), **lệnh kiểm** (chạy lệnh ở gốc repo, kiểm exit code + đầu ra; do qc chạy ở VERIFY/T17 và CI).
- Test chạy CLI (`check-size`, `test-lock`, `trace`, `i18n-check`) dùng **repo git tạm** trong `os.tmpdir()` (`makeRepo`), gọi script bằng đường dẫn tuyệt đối với `cwd` = repo tạm. Không tạo/sửa file trong repo thật khi `bun test` chạy, nên không đụng `tests/.lock` và không cần dọn rác.
- File kiểm không phải test của bun đặt tên `*.check.ts` (bun test không nạp) — chỉ chạy tay/CI bằng `bun <file>`.
- Không `skip`/`only`; không `sleep` cố định (chờ theo điều kiện, hạn chót rõ ràng); dữ liệu cố định, không ngẫu nhiên.
- Tất cả file dưới `tests/acceptance/**` và `e2e/**` sẽ vào `tests/.lock` (hash sau đổi CRLF→LF).

## 2. Bảng AC → kiểm

| AC | Loại | File / lệnh | Dữ liệu | Kỳ vọng |
|---|---|---|---|---|
| M0-AC01 | lệnh kiểm + CI step | mục 4 `ac01` | repo sạch (xoá `node_modules`) | `bun install` exit 0; `bun install --frozen-lockfile` exit 0; đầu ra hai lần không có dòng `warn` nhắc `peer`; `bun.lock` giữ nguyên hash sau lần 2 |
| M0-AC02 | lệnh kiểm + CI (service postgres) | mục 4 `ac02` | compose của repo | `docker compose up -d --wait --wait-timeout 60` exit 0; `ps` có đúng 3 service `postgres`,`redis`,`mailpit`, cả 3 `Health=="healthy"`; tổng thời gian ≤ 60 s (sau pull) |
| M0-AC03 | int | `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` | DB `TEST_DATABASE_URL` (`…_test`), reset trước mỗi test | development: đúng 3 bảng `hub.agent_grants`,`hub.agent_workflows`,`hub.usage_logs`; schema `admin`; role `admin_rw`,`hub_ro` (NOLOGIN); quyền `admin_rw` SELECT 3 bảng hub; default privileges cho bảng/sequence mới trong `admin`; index/CHECK của stub theo §4.2; lần 2 `{main:0, dev:0}`, bảng theo dõi không đổi |
| M0-AC03 (lệnh) | lệnh kiểm | mục 4 `ac03` | DB dev `ai_system` | `bun run db:migrate` exit 0 (2 lần); `docker compose exec -T postgres psql -U ai -d ai_system -Atc "…"` in đúng 3 dòng `hub.agent_grants`,`hub.agent_workflows`,`hub.usage_logs`; `select 1 from pg_namespace where nspname='admin'` → `1`; `count(*)` 2 role → `2` |
| M0-AC04 | int + lệnh kiểm | `migrate.int.test.ts` + mục 4 `ac04` (theo lệnh xong T7) | DB test `ai_system_test` vừa `resetTestDb` | `runMigrations({url: TEST_DATABASE_URL, appEnv:"production"})` trả `{main:1, dev:0}`; schema `admin`,`hub` có; 0 bảng trong `hub`; `to_regclass('drizzle.__drizzle_migrations_dev') is null` → `t` |
| M0-AC05 | lệnh kiểm + CI step | `bun run check` | repo M0 đã commit | exit 0; thời gian < 30 s (NFR spec §6) |
| M0-AC06 | lệnh kiểm + CI step | mục 4 `ac06` | `tests/zz-tmp.ts` (ngoài `tests/acceptance`, không vào lock) import tên không tồn tại từ `@ai/contracts` | `bun run typecheck` exit 0 = `turbo run typecheck` (mọi workspace) **và** `tsc -p tsconfig.tests.json` (gốc repo; phủ `tests/**`, `e2e/**`, `playwright.config.ts`); có file import sai → exit ≠ 0; xoá file |
| M0-AC07 | lệnh kiểm + CI step | mục 4 `ac07` + `tests/acceptance/ADM-NFR-06/ac07.check.ts` | — | `bun test` exit 0 trong < 30 s; `bun test apps packages tools` (unit) < 10 s; đầu ra không liệt kê file dưới `e2e/` hay `*.int.test.ts`; mỗi workspace có code (trừ `packages/config`) có ≥ 1 file `*.test.ts(x)` |
| M0-AC08 | acceptance + int + lệnh kiểm | `health.test.ts` (in-process) + `server.int.test.ts` (server thật, cổng 3091) + mục 4 `ac08` (`curl :3001`) | `version` = `apps/admin-api/package.json` (`0.0.0`) | 200; body đúng `{"status":"ok","version":"0.0.0"}`; parse qua `HealthResponseSchema`; header `X-Request-Id`; request-id hợp lệ được giữ, không hợp lệ bị thay; CORS (origin hợp lệ, `credentials`, `Access-Control-Expose-Headers` gồm `X-Request-Id`; origin lạ bị từ chối); `PORT` sai → exit ≠ 0 nêu tên biến; p95 < 20 ms |
| M0-AC09 | acceptance + int | như AC08 | `GET /khong-co` | 404; body đúng `{"error":{"code":"NOT_FOUND","message":"Not found"}}`; parse qua `ErrorResponseSchema`; có `X-Request-Id`. Kèm 500 `INTERNAL_ERROR` không lộ stack (spec §3.1) |
| M0-AC10 | lệnh kiểm (tự động hoá) | mục 4 `ac10` | `tmp-bad.ts` = `const  a=1` | commit bị từ chối (exit ≠ 0), đầu ra nhắc format; HEAD không đổi; dọn file |
| M0-AC11 | acceptance (CLI, repo tạm) + lệnh kiểm | `tests/acceptance/ADM-NFR-06/check-size.test.ts` + mục 4 `ac11` | 400/401 dòng; test 600/601; miễn trừ; file rỗng; có/không `\n` cuối | 401 → exit 1 + `…: 401 dòng > 400`; 400 → exit 0 + `check:size OK (1 file)`; test 601 → `601 dòng > 600`; miễn trừ OK |
| M0-AC12 | lệnh kiểm + (unit của backend: fixture) | mục 4 `ac12` | cặp `x.routes.ts` import `./x.repo.ts` trong `modules/health/` | `bun run depcruise` exit 1, đầu ra chứa `no-routes-to-repo`; xoá file → exit 0 |
| M0-AC13 | acceptance (CLI, repo tạm) + lệnh kiểm | `tests/acceptance/ADM-NFR-06/test-lock.test.ts` + mục 4 `ac13` | 2 file khoá mẫu | verify khớp → `test:lock OK (2 file)` exit 0; sửa 1 byte → `CHANGED <path>` exit 1; thêm `MISSING`/`UNLOCKED`/CRLF/thiếu lock/tập rỗng/file ignore |
| M0-AC14 | acceptance (CLI, repo tạm) + lệnh kiểm | `tests/acceptance/ADM-NFR-06/trace.test.ts` + mục 4 `ac14` | catalog mẫu 6 mã, spec mẫu `approved`/`in-progress`/`draft`/`_template`, file test có mã chỉ trong dữ liệu, file `__fixtures__` | `trace` ghi `TRACE.md`, giữ nguyên từng byte phần mở đầu trước dòng `\| FR \|` (không có dòng đó → giữ 3 dòng đầu); mỗi mã một dòng với ưu tiên + trạng thái đúng; test chỉ tính khi mã ở path hoặc tên `it/test/describe` (T-TRACE-2) — mã chỉ nằm trong dữ liệu mẫu/comment hoặc file dưới `__fixtures__` **không** tính; `trace <mã>` chỉ in stdout; mã lạ exit 1 `Không tìm thấy`; `--check` exit 1 khi MUST thuộc spec `approved`/`in-progress`/`done` thiếu test |
| M0-AC15 | acceptance (in-process) + lệnh kiểm | `tests/acceptance/ADM-NFR-06/mocks.test.ts` (đặc tả mục 3.10) + mục 4 `ac15` | token `app-mock-ok/401/timeout`, `mock-ok/401/timeout`, token lạ; `Authorization` không dạng Bearer; header `X-Mock-Scenario` hợp lệ/lạ/rỗng | body đúng từng byte theo spec §3.2/§3.3 (Hub `test-run` body `{command, inputs}`, response có `trace: []`); chọn kịch bản theo T-MOCK-1; 401/400 đúng định dạng, báo trường đầu tiên sai; `timeout`: chờ rồi mới validate, client huỷ được |
| M0-AC16 | acceptance (CLI, repo tạm) + lệnh kiểm | `tests/acceptance/ADM-NFR-06/i18n-check.test.ts` (đặc tả mục 3.10) + `bun run i18n:check` | không locale / chỉ `vi.json` / chỉ `en.json` / hai locale khớp / lệch | chưa locale → `i18n:check: chưa có locale, bỏ qua` exit 0; **chỉ một file** → exit 1, `i18n:check: thiếu packages/i18n/locales/<lang>.json`; khớp exit 0; lệch → `MISSING_<lang> <key>` exit 1; repo thật exit 0 |
| M0-AC17 | acceptance | `tests/acceptance/ADM-NFR-06/ci-workflow.test.ts` | `.github/workflows/ci.yml` thật | YAML parse được; `bun-version` 1.3.14; 8 step đúng thứ tự (xen thêm step khác được, gồm step e2e AC18/19); `on` gồm `pull_request` và `push` nhánh `main`; `permissions: contents: read`; step `git fetch origin main:main` có `if` loại nhánh `main` (spec §9 r#7) |
| M0-AC18 | e2e | `e2e/smoke.spec.ts` (mục 3.9) | `playwright.config.ts` (frontend-lead): webServer build + preview admin-web cổng 3000, `/` | `/` status 200; landmark `main`; heading level 1 "Admin Console"; text "Bảng quản trị nền tảng AI"; img "EvoluConsulting" hiện, `naturalWidth > 0`; title "Admin Console"; `html[lang="vi"]`; không có console error / pageerror |
| M0-AC19 | lệnh kiểm + CI step | mục 4 `ac19` | build admin-web | `bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle` exit 0; JS ban đầu ≤ 150 KB gzip, CSS ban đầu ≤ 25 KB gzip (`plan-frontend.md` §6); vượt → exit 1, in từng dòng vượt |

Bổ sung cho spec §2/§3.1/§3.2/§3.3/§4/§6 (không có AC riêng, gộp vào file nêu trên): CORS + `exposeHeaders`, 500 `INTERNAL_ERROR`, `X-Request-Id`, mock Dify/Hub (T-MOCK-1), index + CHECK của `hub-stub`, `resetTestDb` từ chối DB không hậu tố `_test` và URL vắng, p95 `/health`, lỗi kết nối DB rõ ràng, T-CLI-1 (gốc repo theo `cwd`; test gộp stdout+stderr).

Fixture / seed: M0 không seed nghiệp vụ. DB test `ai_system_test` do compose init tạo; `resetTestDb` (`DROP SCHEMA IF EXISTS admin, hub, drizzle CASCADE`) chạy đầu mỗi test int. Role `admin_rw`/`hub_ro` ở mức cluster nên **không** bị reset — chủ ý, kiểm idempotent.

## 3. Nội dung dự kiến nguyên văn

### 3.1 `tests/acceptance/ADM-NFR-06/_helpers.ts` (dùng chung)

```ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "../../..");
export const scriptPath = (name: string): string => join(ROOT, "tools/scripts/src", name);

export type Run = { code: number; out: string };

export function run(cmd: string[], cwd: string, env: Record<string, string> = {}): Run {
  const p = Bun.spawnSync(cmd, {
    cwd,
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: p.exitCode ?? -1, out: p.stdout.toString() + p.stderr.toString() };
}

/** Repo git tạm (nhánh main, chưa commit). Trả về đường dẫn tuyệt đối. */
export function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "qc-m0-"));
  Bun.spawnSync(["git", "init", "-q", "-b", "main"], { cwd: dir });
  writeFiles(dir, files);
  return dir;
}

export function writeFiles(dir: string, files: Record<string, string>): void {
  for (const [rel, text] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, text);
  }
}

export function removeRepo(dir: string): void {
  rmSync(dir, { recursive: true, force: true });
}

/** n dòng `export const <prefix><i> = 1;`, mỗi dòng kết thúc bằng \n. */
export function codeLines(n: number, prefix = "x"): string {
  return Array.from({ length: n }, (_, i) => `export const ${prefix}${i} = 1;\n`).join("");
}

/** Chờ điều kiện (không sleep cố định); hết hạn thì ném lỗi. */
export async function waitFor(
  cond: () => Promise<boolean>,
  what: string,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return;
    await Bun.sleep(50);
  }
  throw new Error(`Hết ${timeoutMs} ms chờ: ${what}`);
}
```

### 3.2 `tests/acceptance/ADM-NFR-06/health.test.ts` (AC08, AC09; admin-api in-process)

```ts
import { describe, expect, it } from "bun:test";
import { ErrorResponseSchema, HealthResponseSchema } from "@ai/contracts";
import pkg from "../../../apps/admin-api/package.json";
import { createApp } from "../../../apps/admin-api/src/app";

const ORIGIN = "http://localhost:3000";
const REQUEST_ID = /^[A-Za-z0-9._-]{1,128}$/;
const app = createApp({ version: pkg.version, corsOrigins: [ORIGIN] });

describe("ADM-NFR-06 · M0-AC08 · GET /health", () => {
  it("ADM-NFR-06 · M0-AC08 · version của admin-api là 0.0.0 ở M0", () => {
    expect(pkg.version).toBe("0.0.0");
  });

  it("ADM-NFR-06 · M0-AC08 · 200 và body đúng {status:ok, version:0.0.0}", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: "0.0.0" });
    expect(HealthResponseSchema.safeParse(body).success).toBe(true);
  });

  it("ADM-NFR-06 · M0-AC08 · luôn có X-Request-Id hợp lệ khi request không gửi", async () => {
    const res = await app.request("/health");
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });

  it("ADM-NFR-06 · M0-AC08 · X-Request-Id hợp lệ được giữ nguyên", async () => {
    const res = await app.request("/health", { headers: { "X-Request-Id": "req-2026.10_01-A" } });
    expect(res.headers.get("x-request-id")).toBe("req-2026.10_01-A");
  });

  it("ADM-NFR-06 · M0-AC08 · X-Request-Id sai định dạng bị thay bằng id mới hợp lệ", async () => {
    for (const bad of ["co dau cach", "x".repeat(129), "<script>"]) {
      const res = await app.request("/health", { headers: { "X-Request-Id": bad } });
      const got = res.headers.get("x-request-id") ?? "";
      expect(got).not.toBe(bad);
      expect(got).toMatch(REQUEST_ID);
    }
  });

  it("ADM-NFR-06 · M0-AC08 · CORS: origin trong CORS_ORIGINS được cho, kèm credentials", async () => {
    const res = await app.request("/health", { headers: { Origin: ORIGIN } });
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
    expect(res.headers.get("access-control-allow-credentials")).toBe("true");
    const exposed = (res.headers.get("access-control-expose-headers") ?? "")
      .split(",")
      .map((h) => h.trim().toLowerCase());
    expect(exposed).toContain("x-request-id");
  });

  it("ADM-NFR-06 · M0-AC08 · CORS: origin lạ không được cho", async () => {
    const res = await app.request("/health", { headers: { Origin: "http://evil.example" } });
    const allow = res.headers.get("access-control-allow-origin");
    expect(allow).not.toBe("http://evil.example");
    expect(allow).not.toBe("*");
  });

  it("ADM-NFR-06 · M0-AC08 · CORS preflight OPTIONS từ origin hợp lệ thành công", async () => {
    const res = await app.request("/health", {
      method: "OPTIONS",
      headers: { Origin: ORIGIN, "Access-Control-Request-Method": "GET" },
    });
    expect([200, 204]).toContain(res.status);
    expect(res.headers.get("access-control-allow-origin")).toBe(ORIGIN);
  });

  it("ADM-NFR-06 · M0-AC08 · p95 của 200 request tuần tự < 20 ms", async () => {
    const samples: number[] = [];
    for (let i = 0; i < 200; i++) {
      const t0 = performance.now();
      const res = await app.request("/health");
      samples.push(performance.now() - t0);
      expect(res.status).toBe(200);
    }
    samples.sort((a, b) => a - b);
    expect(samples[Math.ceil(samples.length * 0.95) - 1] ?? Infinity).toBeLessThan(20);
  });
});

describe("ADM-NFR-06 · M0-AC09 · lỗi chung", () => {
  it("ADM-NFR-06 · M0-AC09 · đường dẫn không tồn tại → 404 NOT_FOUND", async () => {
    const res = await app.request("/khong-co");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toEqual({ error: { code: "NOT_FOUND", message: "Not found" } });
    expect(ErrorResponseSchema.safeParse(body).success).toBe(true);
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });

  it("ADM-NFR-06 · M0-AC09 · lỗi không lường trước → 500 INTERNAL_ERROR, không lộ stack", async () => {
    // version sai định dạng làm HealthResponseSchema.parse ném lỗi trong route (spec §3.1, §9 qc#7)
    const broken = createApp({ version: "khong-phai-semver", corsOrigins: [ORIGIN] });
    const res = await broken.request("/health");
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(text).not.toMatch(/\bat \S+ \(|\.ts:\d+|ZodError/);
    expect(res.headers.get("x-request-id") ?? "").toMatch(REQUEST_ID);
  });
});
```

### 3.3 `tests/acceptance/ADM-NFR-06/server.int.test.ts` (AC08/AC09 trên server thật)

```ts
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { ROOT, waitFor } from "./_helpers";

const PORT = 3091; // không đụng 3001 của dev
const BASE = `http://localhost:${PORT}`;
let proc: ReturnType<typeof Bun.spawn>;

beforeAll(async () => {
  proc = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(PORT), APP_ENV: "test", CORS_ORIGINS: "http://localhost:3000" },
    stdout: "ignore",
    stderr: "ignore",
  });
  await waitFor(
    async () => (await fetch(`${BASE}/health`).catch(() => null))?.status === 200,
    "admin-api lắng nghe /health",
  );
});

afterAll(() => {
  proc.kill();
});

describe("ADM-NFR-06 · M0-AC08/09 · admin-api chạy thật", () => {
  it("ADM-NFR-06 · M0-AC08 · GET /health → 200, body đúng từng byte, có X-Request-Id", async () => {
    const res = await fetch(`${BASE}/health`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"status":"ok","version":"0.0.0"}');
    expect(res.headers.get("x-request-id")).toBeTruthy();
  });

  it("ADM-NFR-06 · M0-AC09 · GET /khong-co → 404 NOT_FOUND", async () => {
    const res = await fetch(`${BASE}/khong-co`);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe('{"error":{"code":"NOT_FOUND","message":"Not found"}}');
  });

  it("ADM-NFR-06 · M0-AC08 · PORT sai → tiến trình thoát ≠ 0, báo tên biến, không lộ giá trị", async () => {
    const bad = Bun.spawn(["bun", "apps/admin-api/src/server.ts"], {
      cwd: ROOT,
      env: { ...process.env, PORT: "abc", APP_ENV: "test", CORS_ORIGINS: "http://localhost:3000" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const code = await bad.exited;
    const out = (await new Response(bad.stdout).text()) + (await new Response(bad.stderr).text());
    expect(code).not.toBe(0);
    expect(out).toContain("PORT");
    expect(out).not.toContain("abc");
  });
});
```

### 3.4 `tests/acceptance/ADM-NFR-06/migrate.int.test.ts` (AC03, AC04)

```ts
import { afterAll, describe, expect, it } from "bun:test";
import { runMigrations } from "@ai/db";
import postgres from "postgres";
import { ROOT, run } from "./_helpers";
import { resetTestDb } from "../../../packages/db/src/test-db";

const URL = process.env.TEST_DATABASE_URL;
if (!URL) {
  throw new Error("TEST_DATABASE_URL chưa đặt — chạy `bun run keys:dev` rồi `bun run test:int`");
}
const sql = postgres(URL, { max: 1, onnotice: () => {} });
afterAll(async () => {
  await sql.end();
});

const HUB_TABLES = ["agent_grants", "agent_workflows", "usage_logs"];

async function tablesIn(schemas: string[]): Promise<string[]> {
  const rows = await sql<{ t: string }[]>`
    select table_schema || '.' || table_name as t
    from information_schema.tables
    where table_schema in ${sql(schemas)}
    order by 1`;
  return rows.map((r) => r.t);
}

describe("ADM-NFR-06 · M0-AC03 · db:migrate (development)", () => {
  it("ADM-NFR-06 · M0-AC03 · có đúng 3 bảng hub.* và không có bảng admin.*", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "development" });
    expect(r).toEqual({ main: 1, dev: 1 });
    expect(await tablesIn(["admin", "hub"])).toEqual([
      "hub.agent_grants",
      "hub.agent_workflows",
      "hub.usage_logs",
    ]);
    const ns = await sql`select 1 as one from pg_namespace where nspname = 'admin'`;
    expect(ns.map((x) => x.one)).toEqual([1]);
  });

  it("ADM-NFR-06 · M0-AC03 · role admin_rw và hub_ro tồn tại, NOLOGIN", async () => {
    const rows = await sql<{ rolname: string; rolcanlogin: boolean }[]>`
      select rolname, rolcanlogin from pg_roles
      where rolname in ('admin_rw', 'hub_ro') order by 1`;
    expect(rows.map((r) => [r.rolname, r.rolcanlogin])).toEqual([
      ["admin_rw", false],
      ["hub_ro", false],
    ]);
  });

  it("ADM-NFR-06 · M0-AC03 · admin_rw chỉ SELECT được 3 bảng hub.*; USAGE schema admin/hub", async () => {
    for (const t of HUB_TABLES) {
      const [p] = await sql<{ sel: boolean; ins: boolean }[]>`
        select has_table_privilege('admin_rw', ${`hub.${t}`}, 'SELECT') as sel,
               has_table_privilege('admin_rw', ${`hub.${t}`}, 'INSERT') as ins`;
      expect(p).toEqual({ sel: true, ins: false });
    }
    const [s] = await sql<{ a: boolean; h: boolean; r: boolean }[]>`
      select has_schema_privilege('admin_rw', 'admin', 'USAGE') as a,
             has_schema_privilege('admin_rw', 'hub', 'USAGE') as h,
             has_schema_privilege('hub_ro', 'admin', 'USAGE') as r`;
    expect(s).toEqual({ a: true, h: true, r: true });
  });

  it("ADM-NFR-06 · M0-AC03 · default privileges: bảng/sequence mới trong admin cấp đúng quyền", async () => {
    await sql`create table admin.qc_probe (id serial primary key)`;
    try {
      const [p] = await sql<Record<string, boolean>[]>`
        select has_table_privilege('admin_rw', 'admin.qc_probe', 'INSERT') as rw_ins,
               has_table_privilege('admin_rw', 'admin.qc_probe', 'DELETE') as rw_del,
               has_table_privilege('hub_ro', 'admin.qc_probe', 'SELECT') as ro_sel,
               has_table_privilege('hub_ro', 'admin.qc_probe', 'INSERT') as ro_ins,
               has_sequence_privilege('admin_rw', 'admin.qc_probe_id_seq', 'USAGE') as rw_seq`;
      expect(p).toEqual({ rw_ins: true, rw_del: true, ro_sel: true, ro_ins: false, rw_seq: true });
    } finally {
      await sql`drop table admin.qc_probe`;
    }
  });

  it("ADM-NFR-06 · M0-AC03 · stub hub: index và ràng buộc theo spec §4.2", async () => {
    const idx = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where schemaname = 'hub' order by 1`;
    const names = idx.map((i) => i.indexname);
    for (const n of [
      "agent_workflows_workflow_id_idx",
      "agent_grants_uq",
      "agent_grants_subject_idx",
      "usage_logs_tenant_at_idx",
      "usage_logs_tenant_feature_at_idx",
    ]) {
      expect(names).toContain(n);
    }
    const A = "00000000-0000-7000-8000-0000000000a1";
    const T = "00000000-0000-7000-8000-0000000000b1";
    await expect(
      sql`insert into hub.agent_grants (agent_id, tenant_id, subject_type, subject_id)
          values (${A}, ${T}, 'team', ${A})`,
    ).rejects.toThrow();
    await expect(
      sql`insert into hub.usage_logs (tenant_id, billing) values (${T}, 'khac')`,
    ).rejects.toThrow();
    await expect(
      sql`insert into hub.usage_logs (tenant_id, billing, input_tokens) values (${T}, 'api', -1)`,
    ).rejects.toThrow();
    const [row] = await sql<{ input_tokens: number; overage: boolean; cost_usd: string | null }[]>`
      insert into hub.usage_logs (tenant_id, billing) values (${T}, 'dify')
      returning input_tokens, overage, cost_usd`;
    expect(row).toEqual({ input_tokens: 0, overage: false, cost_usd: null });
  });

  it("ADM-NFR-06 · M0-AC03 · chạy lần 2 không đổi gì (exit/idempotent)", async () => {
    const count = async (t: string) =>
      (await sql.unsafe(`select count(*)::int as n from drizzle.${t}`))[0]?.n;
    const before = [await count("__drizzle_migrations"), await count("__drizzle_migrations_dev")];
    const r = await runMigrations({ url: URL, appEnv: "development" });
    expect(r).toEqual({ main: 0, dev: 0 });
    expect([await count("__drizzle_migrations"), await count("__drizzle_migrations_dev")]).toEqual(
      before,
    );
    expect(before).toEqual([1, 1]);
  });

  it("ADM-NFR-06 · M0-AC03 · role đã có sẵn (DB reset nhưng role ở mức cluster) vẫn migrate được", async () => {
    await resetTestDb(URL);
    await expect(runMigrations({ url: URL, appEnv: "test" })).resolves.toEqual({ main: 1, dev: 1 });
  });

  it("ADM-NFR-06 · M0-AC03 · db:migrate không kết nối được → exit 1, nêu ECONNREFUSED và gợi ý compose", () => {
    const r = run(["bun", "packages/db/src/migrate.ts"], ROOT, {
      APP_ENV: "test",
      DATABASE_URL: "postgres://ai:ai_dev_pw@127.0.0.1:1/ai_system",
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("ECONNREFUSED");
    expect(r.out).toContain("docker compose up -d --wait");
  });
});

describe("ADM-NFR-06 · M0-AC04 · db:migrate (production)", () => {
  it("ADM-NFR-06 · M0-AC04 · có schema admin, hub; không có bảng hub.*; không có bảng theo dõi dev", async () => {
    await resetTestDb(URL);
    const r = await runMigrations({ url: URL, appEnv: "production" });
    expect(r).toEqual({ main: 1, dev: 0 });
    const ns = await sql<{ nspname: string }[]>`
      select nspname from pg_namespace where nspname in ('admin', 'hub') order by 1`;
    expect(ns.map((n) => n.nspname)).toEqual(["admin", "hub"]);
    expect(await tablesIn(["admin", "hub"])).toEqual([]);
    const [dev] = await sql<{ r: string | null }[]>`
      select to_regclass('drizzle.__drizzle_migrations_dev')::text as r`;
    expect(dev?.r).toBeNull();
  });
});

describe("ADM-NFR-06 · M0-AC03 · resetTestDb an toàn", () => {
  it("ADM-NFR-06 · M0-AC03 · resetTestDb từ chối DB không có hậu tố _test", async () => {
    // host/cổng không tồn tại: nếu bản cài đặt quên kiểm tên thì cũng không xoá được gì
    await expect(resetTestDb("postgres://ai:x@127.0.0.1:1/ai_system")).rejects.toThrow(/_test/);
  });

  it("ADM-NFR-06 · M0-AC03 · resetTestDb với URL vắng/rỗng → lỗi nêu TEST_DATABASE_URL", async () => {
    await expect(resetTestDb(undefined)).rejects.toThrow("TEST_DATABASE_URL chưa đặt");
    await expect(resetTestDb("")).rejects.toThrow("TEST_DATABASE_URL chưa đặt");
  });
});
```

### 3.5 `tests/acceptance/ADM-NFR-06/check-size.test.ts` (AC11)

```ts
import { afterEach, describe, expect, it } from "bun:test";
import { codeLines, makeRepo, removeRepo, run, scriptPath } from "./_helpers";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

function check(files: Record<string, string>) {
  const dir = makeRepo(files);
  dirs.push(dir);
  return run(["bun", scriptPath("check-size.ts"), "--files", ...Object.keys(files)], dir);
}

describe("ADM-NFR-06 · M0-AC11 · check:size (T-SIZE-1..5)", () => {
  it("ADM-NFR-06 · M0-AC11 · file code 401 dòng → exit 1, in dòng vi phạm", () => {
    const r = check({ "apps/admin-api/src/tmp-401.ts": codeLines(401) });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/tmp-401.ts: 401 dòng > 400");
  });

  it("ADM-NFR-06 · M0-AC11 · file code 400 dòng → exit 0, in check:size OK (1 file)", () => {
    const r = check({ "apps/admin-api/src/tmp-401.ts": codeLines(400) });
    expect(r.code).toBe(0);
    expect(r.out).toContain("check:size OK (1 file)");
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · đếm dòng: 400 dòng không có \\n cuối vẫn là 400; 401 dòng không có \\n cuối là vi phạm", () => {
    const noTrailing400 = codeLines(400).slice(0, -1);
    expect(check({ "apps/admin-api/src/a.ts": noTrailing400 }).code).toBe(0);
    const noTrailing401 = codeLines(401).slice(0, -1);
    const r = check({ "apps/admin-api/src/b.ts": noTrailing401 });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/b.ts: 401 dòng > 400");
  });

  it("ADM-NFR-06 · M0-AC11 · file rỗng = 0 dòng → OK", () => {
    expect(check({ "apps/admin-api/src/empty.ts": "" }).code).toBe(0);
  });

  it("ADM-NFR-06 · M0-AC11 · file test: 600 dòng OK, 601 dòng vi phạm (*.test.ts và dưới tests/)", () => {
    expect(check({ "apps/admin-api/src/big.test.ts": codeLines(600) }).code).toBe(0);
    const a = check({ "apps/admin-api/src/big.test.ts": codeLines(601) });
    expect(a.code).toBe(1);
    expect(a.out).toContain("apps/admin-api/src/big.test.ts: 601 dòng > 600");
    expect(check({ "tests/acceptance/X/helper.ts": codeLines(500) }).code).toBe(0);
    const b = check({ "tests/acceptance/X/helper.ts": codeLines(601) });
    expect(b.out).toContain("tests/acceptance/X/helper.ts: 601 dòng > 600");
  });

  it("ADM-NFR-06 · M0-AC11 · miễn trừ: components/ui, migrations, *.gen.ts không bị tính", () => {
    const r = check({
      "apps/admin-web/src/components/ui/button.tsx": codeLines(500),
      "packages/db/migrations/0001_big.ts": codeLines(500),
      "apps/admin-web/src/routeTree.gen.ts": codeLines(500),
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · file không phải code (.md, .json, .sql) không bị tính", () => {
    const r = check({
      "docs/long.md": codeLines(1000),
      "data.json": codeLines(1000),
      "packages/db/q.sql": codeLines(1000),
    });
    expect(r.code).toBe(0);
    expect(r.out).not.toContain("dòng >");
  });

  it("ADM-NFR-06 · M0-AC11 · nhiều vi phạm → mỗi file một dòng, exit 1", () => {
    const r = check({
      "apps/admin-api/src/p.ts": codeLines(401),
      "apps/admin-api/src/q.ts": codeLines(402),
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain("apps/admin-api/src/p.ts: 401 dòng > 400");
    expect(r.out).toContain("apps/admin-api/src/q.ts: 402 dòng > 400");
  });
});
```

### 3.6 `tests/acceptance/ADM-NFR-06/test-lock.test.ts` (AC13)

```ts
import { createHash } from "node:crypto";
import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { makeRepo, removeRepo, run, scriptPath, writeFiles } from "./_helpers";

const HEADER = "# tests/.lock — sinh bởi bun run test:lock:write (chỉ qc). Không sửa tay.";
const A = "tests/acceptance/A/a.test.ts";
const E = "e2e/s.spec.ts";
const sha = (t: string) => createHash("sha256").update(t.replace(/\r\n/g, "\n")).digest("hex");

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

const lock = (dir: string, mode: "verify" | "write") =>
  run(["bun", scriptPath("test-lock.ts"), mode], dir);

function lockedRepo(extra: Record<string, string> = {}): string {
  const dir = makeRepo({
    [A]: 'import { it } from "bun:test";\nit("ADM-NFR-06 · x", () => {});\n',
    [E]: 'import { test } from "@playwright/test";\ntest("ADM-NFR-06 · y", () => {});\n',
    ...extra,
  });
  dirs.push(dir);
  expect(lock(dir, "write").code).toBe(0);
  return dir;
}

describe("ADM-NFR-06 · M0-AC13 · test:lock (T-LOCK-1..3)", () => {
  it("ADM-NFR-06 · M0-AC13 · write ghi đúng định dạng: header, sha256, hai dấu cách, path tăng dần, \\n cuối", () => {
    const dir = lockedRepo();
    const text = readFileSync(join(dir, "tests/.lock"), "utf8");
    const expected =
      `${HEADER}\n` +
      `${sha(readFileSync(join(dir, E), "utf8"))}  ${E}\n` +
      `${sha(readFileSync(join(dir, A), "utf8"))}  ${A}\n`;
    expect(text).toBe(expected);
  });

  it("ADM-NFR-06 · M0-AC13 · verify khi khớp → exit 0, test:lock OK (2 file)", () => {
    const dir = lockedRepo();
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (2 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · sửa 1 byte file khoá → exit 1, CHANGED <path>", () => {
    const dir = lockedRepo();
    writeFileSync(join(dir, A), `${readFileSync(join(dir, A), "utf8")} `);
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain(`CHANGED ${A}`);
    expect(r.out).not.toContain(`CHANGED ${E}`);
  });

  it("ADM-NFR-06 · M0-AC13 · xoá file khoá → MISSING <path>", () => {
    const dir = lockedRepo();
    rmSync(join(dir, E));
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain(`MISSING ${E}`);
  });

  it("ADM-NFR-06 · M0-AC13 · thêm file test mới chưa khoá → UNLOCKED <path>", () => {
    const dir = lockedRepo();
    writeFiles(dir, { "tests/acceptance/A/b.test.ts": "export {};\n" });
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain("UNLOCKED tests/acceptance/A/b.test.ts");
  });

  it("ADM-NFR-06 · M0-AC13 · đổi \\n thành \\r\\n không làm đổi hash", () => {
    const dir = lockedRepo();
    const text = readFileSync(join(dir, A), "utf8");
    writeFileSync(join(dir, A), text.replace(/\n/g, "\r\n"));
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (2 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · file bị .gitignore không nằm trong tập khoá", () => {
    const dir = makeRepo({ [A]: "export {};\n", ".gitignore": "e2e/out.spec.ts\n", "e2e/out.spec.ts": "x\n" });
    dirs.push(dir);
    expect(lock(dir, "write").code).toBe(0);
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (1 file)");
  });

  it("ADM-NFR-06 · M0-AC13 · thiếu tests/.lock → exit 1, 'tests/.lock không tồn tại'", () => {
    const dir = makeRepo({ [A]: "export {};\n" });
    dirs.push(dir);
    const r = lock(dir, "verify");
    expect(r.code).toBe(1);
    expect(r.out).toContain("tests/.lock không tồn tại");
  });

  it("ADM-NFR-06 · M0-AC13 · tập rỗng: lock chỉ có dòng đầu, verify OK (0 file)", () => {
    const dir = makeRepo({ "README.md": "x\n" });
    dirs.push(dir);
    expect(lock(dir, "write").code).toBe(0);
    expect(readFileSync(join(dir, "tests/.lock"), "utf8")).toBe(`${HEADER}\n`);
    const r = lock(dir, "verify");
    expect(r.code).toBe(0);
    expect(r.out).toContain("test:lock OK (0 file)");
  });
});
```

### 3.7 `tests/acceptance/ADM-NFR-06/trace.test.ts` (AC14; T-TRACE-1..4)

Lưu ý dữ liệu mẫu: mọi chuỗi mô phỏng tên test của mã khác dựng qua biến `IT`/`DESCRIBE`/`TEST` để mã nguồn file này **không** chứa nguyên văn `it("ADM-…` (quy ước mục 1) — nếu không, `trace` trên repo thật sẽ tính nhầm `ADM-BR-03`, `ADM-FR-04` là có test.

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "bun:test";
import { makeRepo, removeRepo, run, scriptPath } from "./_helpers";

// Dựng tên hàm test qua biến: nguồn file này không chứa nguyên văn `it("<mã khác>` (T-TRACE-2 vế b).
const IT = "it";
const TEST = "test";
const DESCRIBE = "describe";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) removeRepo(dirs.pop() as string);
});

const spec = (id: string, reqs: string[], status: string) =>
  `---\nid: ${id}\nrequirements: [${reqs.join(", ")}]\nstatus: ${status}\n---\n# ${id}\n`;

const CATALOG = [
  "# BA mẫu",
  "| Mã | Yêu cầu | Ưu tiên |",
  "|---|---|---|",
  "| ADM-FR-01 | Tạo tenant | **MUST** |",
  "| ADM-FR-02 | Xem báo cáo | **SHOULD** |",
  "| ADM-BR-03 | Quy tắc làm tròn | |",
  "| ADM-FR-04 | Khoá tài khoản | **MUST** |",
  "| ADM-FR-05 | Nhập CSV | **MUST** |",
  "| ADM-FR-06 | Mẫu | **MUST** |",
  "",
].join("\n");

// Phần mở đầu trước dòng `| FR |` (T-TRACE-4): tiêu đề, dòng trống, 2 dòng mô tả, dòng trống.
const TRACE_PREFIX =
  "# TRACE — yêu cầu → spec → code → test\n\n" +
  "Sinh tự động bằng `bun run trace`. Không sửa tay.\n" +
  "Dòng mô tả thứ hai giữ nguyên.\n\n";
const TABLE_HEAD = "| FR | Ưu tiên | Spec | Code | Test | Trạng thái |\n|---|---|---|---|---|---|\n";

function base(extra: Record<string, string> = {}): Record<string, string> {
  return {
    "docs/design/demo/ba-demo.md": CATALOG,
    "docs/TRACE.md": `${TRACE_PREFIX}${TABLE_HEAD}| ADM-FR-99 | cũ | | | | dòng cũ phải bị ghi đè |\n`,
    "docs/specs/S1/spec.md": spec("S1", ["ADM-FR-01", "ADM-FR-02"], "approved"),
    "docs/specs/S3/spec.md": spec("S3", ["ADM-FR-05"], "draft"),
    "docs/specs/_template/spec.md": spec("_template", ["ADM-FR-06"], "approved"),
    "apps/admin-api/src/x.ts": "// ADM-FR-01\nexport const x = 1;\n",
    "apps/admin-api/src/y.ts": "// ADM-FR-02\nexport const y = 1;\n",
    // (a) mã trong path
    "tests/acceptance/ADM-FR-01/a.test.ts": "export {};\n",
    // (b) mã ở đầu tên test
    "tests/acceptance/misc/br.test.ts": `import { it } from "bun:test";\n${IT}("ADM-BR-03 · luật", () => {});\n`,
    ...extra,
  };
}

function repo(extra: Record<string, string> = {}): string {
  const dir = makeRepo(base(extra));
  dirs.push(dir);
  return dir;
}
const trace = (dir: string, ...args: string[]) =>
  run(["bun", scriptPath("trace.ts"), ...args], dir);
const rowOf = (md: string, id: string) =>
  md.split("\n").filter((l) => new RegExp(`\\b${id}\\b`).test(l));
const traceMd = (dir: string) => readFileSync(join(dir, "docs/TRACE.md"), "utf8");

// S2 approved nhận ADM-FR-04; mã này chỉ xuất hiện trong dữ liệu/comment/__fixtures__/mã dài hơn.
const FR04_NOT_TESTED: Record<string, string> = {
  "docs/specs/S2/spec.md": spec("S2", ["ADM-FR-04"], "approved"),
  "tests/acceptance/misc/data.test.ts":
    'import { expect, it } from "bun:test";\n' +
    "// ADM-FR-04 chỉ là dữ liệu mẫu trong comment\n" +
    'const sample = { code: "ADM-FR-04", row: "| ADM-FR-04 | Khoá tài khoản |" };\n' +
    `${IT}("ADM-NFR-06 · dùng dữ liệu mẫu", () => {\n  expect(sample.code).toBe("ADM-FR-04");\n});\n`,
  "e2e/data.spec.ts": 'export const label = "ADM-FR-04";\n',
  "tests/acceptance/misc/longer.test.ts": `${IT}("ADM-FR-040 · mã khác, dài hơn", () => {});\n`,
  "tests/acceptance/__fixtures__/f.test.ts": `${IT}("ADM-FR-04 · nằm trong fixture", () => {});\n`,
  "tools/scripts/src/__fixtures__/trace/ADM-FR-04.test.ts": "export {};\n",
  "apps/admin-api/src/__fixtures__/z.ts": "// ADM-FR-04\nexport const z = 1;\n",
};

describe("ADM-NFR-06 · M0-AC14 · trace (T-TRACE-1..4)", () => {
  it("ADM-NFR-06 · M0-AC14 · `trace` ghi TRACE.md, giữ nguyên từng byte phần mở đầu trước `| FR |`, mỗi mã một dòng", () => {
    const dir = repo();
    const r = trace(dir);
    expect(r.code).toBe(0);
    const md = traceMd(dir);
    expect(md.startsWith(TRACE_PREFIX)).toBe(true);
    expect(md.slice(TRACE_PREFIX.length).startsWith("| FR |")).toBe(true);
    expect(md).not.toContain("dòng cũ phải bị ghi đè");
    const r01 = rowOf(md, "ADM-FR-01");
    expect(r01).toHaveLength(1);
    expect(r01[0]).toContain("MUST");
    expect(r01[0]).toContain("có test"); // test theo path (vế a)
    expect(rowOf(md, "ADM-FR-02")[0]).toContain("SHOULD");
    expect(rowOf(md, "ADM-FR-02")[0]).toContain("có code");
    expect(rowOf(md, "ADM-FR-05")[0]).toContain("có spec"); // spec draft vẫn tính là có spec
    expect(rowOf(md, "ADM-BR-03")[0]).toContain("chưa spec"); // có test (vế b) nhưng không spec nào nhận
    expect(rowOf(md, "ADM-BR-03")[0]).toContain("—"); // không ghi ưu tiên
    expect(rowOf(md, "ADM-FR-06")[0]).toContain("chưa spec"); // _template bị bỏ qua
  });

  it("ADM-NFR-06 · M0-AC14 · TRACE.md không có dòng `| FR |` → giữ 3 dòng đầu", () => {
    const dir = repo({ "docs/TRACE.md": "# TRACE\n\nMô tả một dòng.\nDòng thứ tư.\n" });
    expect(trace(dir).code).toBe(0);
    expect(traceMd(dir).split("\n").slice(0, 3)).toEqual(["# TRACE", "", "Mô tả một dòng."]);
    expect(rowOf(traceMd(dir), "ADM-FR-01")).toHaveLength(1);
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: file test chứa mã FR chỉ trong dữ liệu mẫu/comment KHÔNG được tính là có test", () => {
    const dir = repo(FR04_NOT_TESTED);
    expect(trace(dir).code).toBe(0);
    const row = rowOf(traceMd(dir), "ADM-FR-04");
    expect(row).toHaveLength(1);
    expect(row[0]).toContain("có spec"); // __fixtures__ cũng không làm thành "có code"
    expect(row[0]).not.toContain("có test");
    expect(row[0]).not.toContain("có code");
    const one = trace(dir, "ADM-FR-04");
    expect(one.code).toBe(0);
    expect(one.out).not.toContain("tests/acceptance/misc/data.test.ts");
    expect(one.out).not.toContain("e2e/data.spec.ts");
    expect(one.out).not.toContain("tests/acceptance/misc/longer.test.ts");
    expect(one.out).not.toContain("__fixtures__");
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: --check vẫn chặn khi ADM-FR-04 chỉ có trong dữ liệu mẫu / __fixtures__", () => {
    const r = trace(repo(FR04_NOT_TESTED), "--check");
    expect(r.code).toBe(1);
    expect(r.out).toContain("ADM-FR-04");
  });

  it("ADM-NFR-06 · M0-AC14 · T-TRACE-2: tên describe/test bắt đầu bằng mã (backtick, nháy đơn, xuống dòng) được tính", () => {
    for (const body of [
      `${DESCRIBE}(\n  \`ADM-FR-04 · nhóm\`, () => {});\n`,
      `${TEST}('ADM-FR-04 · một ca', () => {});\n`,
    ]) {
      const dir = repo({ ...FR04_NOT_TESTED, "tests/acceptance/misc/real.test.ts": body });
      expect(trace(dir).code).toBe(0);
      expect(rowOf(traceMd(dir), "ADM-FR-04")[0]).toContain("có test");
      expect(trace(dir, "--check").code).toBe(0);
    }
  });

  it("ADM-NFR-06 · M0-AC14 · `trace <mã>` in ưu tiên, spec, trạng thái, exit 0, KHÔNG ghi file", () => {
    const dir = repo();
    const before = traceMd(dir);
    const r = trace(dir, "ADM-FR-01");
    expect(r.code).toBe(0);
    expect(r.out).toContain("docs/specs/S1/spec.md");
    expect(r.out).toContain("MUST");
    expect(r.out).toContain("có test");
    expect(traceMd(dir)).toBe(before);
  });

  it("ADM-NFR-06 · M0-AC14 · `trace <mã lạ>` → exit 1, 'Không tìm thấy <mã>'", () => {
    const r = trace(repo(), "ADM-FR-999");
    expect(r.code).toBe(1);
    expect(r.out).toContain("Không tìm thấy ADM-FR-999");
  });

  it("ADM-NFR-06 · M0-AC14 · mã 4 chữ số không khớp regex (\\d{2,3}) nên không được coi là mã", () => {
    const dir = repo({ "apps/admin-api/src/z.ts": "// ADM-FR-1234\n" });
    expect(trace(dir, "ADM-FR-1234").code).toBe(1);
  });

  it("ADM-NFR-06 · M0-AC14 · --check: MUST thuộc spec approved / in-progress / done mà thiếu test → exit 1 và liệt kê mã", () => {
    for (const status of ["approved", "in-progress", "done"]) {
      const dir = repo({ "docs/specs/S2/spec.md": spec("S2", ["ADM-FR-04"], status) });
      const r = trace(dir, "--check");
      expect(r.code).toBe(1);
      expect(r.out).toContain("ADM-FR-04");
      expect(r.out).not.toContain("ADM-FR-05"); // spec draft không bị chặn
      expect(r.out).not.toContain("ADM-FR-01"); // đã có test
    }
  });

  it("ADM-NFR-06 · M0-AC14 · --check: đủ test (hoặc SHOULD/không ưu tiên/spec draft) → exit 0", () => {
    expect(trace(repo(), "--check").code).toBe(0);
  });

  it("ADM-NFR-06 · M0-AC14 · `trace` không đối số lần 2 cho cùng kết quả (idempotent)", () => {
    const dir = repo();
    expect(trace(dir).code).toBe(0);
    const first = traceMd(dir);
    expect(trace(dir).code).toBe(0);
    expect(traceMd(dir)).toBe(first);
  });
});
```

### 3.8 `tests/acceptance/ADM-NFR-06/ci-workflow.test.ts` (AC17)

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { ROOT } from "./_helpers";

type Step = { name?: string; uses?: string; run?: string; with?: Record<string, unknown> };
const text = readFileSync(join(ROOT, ".github/workflows/ci.yml"), "utf8");
const doc = Bun.YAML.parse(text) as {
  on?: Record<string, unknown>;
  jobs: Record<string, { steps: Step[] }>;
};
const steps: Step[] = Object.values(doc.jobs).flatMap((j) => j.steps);
const runs = steps.map((s) => s.run ?? "");

describe("ADM-NFR-06 · M0-AC17 · .github/workflows/ci.yml", () => {
  it("ADM-NFR-06 · M0-AC17 · YAML hợp lệ và có ít nhất một job", () => {
    expect(Object.keys(doc.jobs).length).toBeGreaterThan(0);
  });

  it("ADM-NFR-06 · M0-AC17 · dùng bun 1.3.14 (oven-sh/setup-bun)", () => {
    const setup = steps.find((s) => s.uses?.startsWith("oven-sh/setup-bun@"));
    expect(String(setup?.with?.["bun-version"])).toBe("1.3.14");
  });

  it("ADM-NFR-06 · M0-AC17 · đủ 8 step đúng thứ tự (được xen step khác)", () => {
    const order = [
      /\bbun install --frozen-lockfile\b/,
      /\bbun run check(\s|$)/,
      /\bbun run typecheck\b/,
      /\bbun test(\s|$)/,
      /\bbun run db:migrate\b/,
      /\bbun run test:int\b/,
      /\bbun run test:lock:verify\b/,
      /\bbun run trace --check\b/,
    ];
    let from = 0;
    for (const re of order) {
      const at = runs.findIndex((r, i) => i >= from && re.test(r));
      expect(at, `thiếu hoặc sai thứ tự step ${re}`).toBeGreaterThanOrEqual(from);
      from = at + 1;
    }
  });

  it("ADM-NFR-06 · M0-AC17 · chạy trên pull_request và push nhánh main; quyền chỉ đọc", () => {
    const on = (doc.on ?? (doc as unknown as Record<string, Record<string, unknown>>)["true"]) as
      | Record<string, unknown>
      | undefined;
    expect(Object.keys(on ?? {})).toEqual(expect.arrayContaining(["pull_request", "push"]));
    expect(JSON.stringify(on?.push)).toContain("main");
    expect(text).toMatch(/permissions:\s*\n\s+contents:\s*read/);
  });

  it("ADM-NFR-06 · M0-AC17 · có step `git fetch origin main:main` trước install, chỉ chạy khi không ở nhánh main (spec §9 r#7)", () => {
    const at = steps.findIndex((s) => /\bgit fetch origin main:main\b/.test(s.run ?? ""));
    expect(at).toBeGreaterThanOrEqual(0);
    const install = steps.findIndex((s) => /\bbun install --frozen-lockfile\b/.test(s.run ?? ""));
    expect(at).toBeLessThan(install);
    const cond = String((steps[at] as Step & { if?: unknown }).if ?? "");
    expect(cond).toContain("refs/heads/main");
    expect(cond).toContain("!=");
  });

  it("ADM-NFR-06 · M0-AC17 · không chứa secret thật / mật khẩu ngoài giá trị dev", () => {
    expect(text).not.toMatch(/BEGIN (PRIVATE|RSA) KEY/);
  });
});
```

### 3.9 `e2e/smoke.spec.ts` (M0-AC18; theo `plan-frontend.md` §5, §7)

```ts
import { expect, test } from "@playwright/test";

test("ADM-NFR-06 · M0-AC18 · mở / thấy Admin Console", async ({ page }) => {
  const problems: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") problems.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => problems.push(`pageerror: ${e.message}`));

  const res = await page.goto("/");
  expect(res?.status()).toBe(200);

  await expect(page.getByRole("main")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "Admin Console" })).toBeVisible();
  await expect(page.getByText("Bảng quản trị nền tảng AI")).toBeVisible();

  const logo = page.getByRole("img", { name: "EvoluConsulting" });
  await expect(logo).toBeVisible();
  await expect
    .poll(() => logo.evaluate((el) => (el as HTMLImageElement).naturalWidth))
    .toBeGreaterThan(0);

  await expect(page).toHaveTitle("Admin Console");
  await expect(page.locator("html")).toHaveAttribute("lang", "vi");
  expect(problems).toEqual([]);
});
```

### 3.10 Đặc tả (viết nguyên văn ở Q2) — `mocks.test.ts` (M0-AC15) và `i18n-check.test.ts` (M0-AC16)

#### `tests/acceptance/ADM-NFR-06/mocks.test.ts`

Gọi in-process `createDifyMock({ timeoutMs: 50 }).request(...)` và `createHubMock({ timeoutMs: 50 }).request(...)` (import từ `tools/mocks/src/dify.ts`, `hub.ts`; spec §7, plan.md). So body bằng `toEqual` với giá trị cố định spec §3.2/§3.3. Header chung: `Content-Type: application/json`. Mọi tên test dạng `ADM-NFR-06 · M0-AC15 · …`; `describe` theo nhóm dưới đây.

Hằng dùng lại: `U = "00000000-0000-7000-8000-0000000000c1"` (user_id hợp lệ), `WF_BODY = {inputs:{text:"a"}, response_mode:"blocking", user:"u1"}`, `CHAT_BODY = {query:"hi", inputs:{}, response_mode:"blocking", user:"u1"}`, `RUN_BODY = {command:{steps:[{type:"llm"}]}, inputs:{text:"a"}}`. Body 401 Dify `D401 = {code:"unauthorized", message:"Access token is invalid", status:401}`; body 401 Hub `H401 = {error:{code:"UNAUTHORIZED", message:"Invalid token"}}`.

**A. Dify — kịch bản `ok`**
1. `Bearer app-mock-ok` và token lạ `Bearer app-whatever`: `POST /v1/workflows/run` `WF_BODY` → 200, body đúng spec §3.2 (`workflow_run_id:"mock-wfr-0001"`, `task_id:"mock-task-0001"`, `data.id:"mock-wfr-0001"`, `data.workflow_id:"mock-wf-0001"`, `data.status:"succeeded"`, `data.outputs.text:'mock:{"text":"a"}'`, `error:null`, `elapsed_time:0.12`, `total_tokens:42`, `total_steps:3`, `created_at:1767225600`, `finished_at:1767225601`).
2. `POST /v1/chat-messages` `CHAT_BODY` → 200, body đúng §3.2 (`answer:"mock answer: hi"`, `metadata.usage` đủ 6 trường, `created_at:1767225600`); thêm `conversation_id:"c1"` vẫn 200.
3. `GET /v1/parameters` → 200, body đúng §3.2 (`user_input_form` 2 phần tử, `system_parameters:{}`).
4. Tiền tố `Bearer` không phân biệt hoa thường: `Authorization: bearer app-mock-ok` → 200 (T-MOCK-1 bước 2).

**B. Dify — `unauthorized` (T-MOCK-1)**
1. `Bearer app-mock-401` + body `{}` → 401 `D401` (kịch bản thắng validate body).
2. Không có `Authorization` → 401 `D401` (cả `POST /v1/workflows/run` và `GET /v1/parameters`).
3. `Authorization` không dạng `Bearer <token>`: `Basic YTpi`, `app-mock-ok` (không tiền tố), `Bearer` (không token) → 401 `D401`.

**C. Dify — 400 `invalid_param` (spec §3.2, báo trường đầu tiên sai)** — token `app-mock-ok`, kỳ vọng `{code:"invalid_param", message:<m>, status:400}`:
1. workflows `{}` → `inputs is required`; chat `{}` → `query is required` (thứ tự `query` → `inputs` → `user` → `response_mode`).
2. workflows thiếu đúng `user` → `user is required`; chat thiếu đúng `inputs` → `inputs is required`.
3. `inputs: null`, `inputs: []`, `inputs: "x"` → `inputs is required` ("object" = object JSON, khác null, không phải mảng).
4. `response_mode: "streaming"` → `response_mode must be blocking`; thiếu `response_mode` → `response_mode is required`.
5. Body không phải JSON (`"khong-phai-json"`) → như `{}` → workflows `inputs is required`.

**D. Dify — header `X-Mock-Scenario` (T-MOCK-1 bước 1)**
1. `X-Mock-Scenario: unauthorized` + `Bearer app-mock-ok` → 401 `D401`.
2. `X-Mock-Scenario: ok` + `Bearer app-mock-401` → 200 body `ok`; `X-Mock-Scenario: ok` + không `Authorization` → 200 (header hợp lệ đứng trước bước 2).
3. Giá trị lạ **bị bỏ qua, chọn theo token**: `X-Mock-Scenario: khac` + `Bearer app-mock-401` → 401; `X-Mock-Scenario: khac` + `Bearer app-mock-ok` → 200; `X-Mock-Scenario: ""` + `Bearer app-mock-401` → 401; `X-Mock-Scenario: OK` (sai hoa thường, không khớp chính xác) + `Bearer app-mock-401` → 401.
4. `X-Mock-Scenario: timeout` + `Bearer app-mock-ok` → hành xử như kịch bản timeout (E1).

**E. Dify — `timeout` (chờ trước, rồi mới validate)** — `timeoutMs: 50`:
1. Huỷ phía client cần HTTP thật (in-process `app.request` không huỷ được handler đang chờ): `const srv = Bun.serve({ port: 0, fetch: createDifyMock({ timeoutMs: 50 }).fetch })`, `POST http://localhost:<srv.port>/v1/workflows/run` bằng `fetch` với `Authorization: Bearer app-mock-timeout`, body `WF_BODY`, `signal: AbortSignal.timeout(20)` → reject, `name ∈ {"TimeoutError","AbortError"}`; `srv.stop(true)` trong `afterAll`.
2. Không huỷ: `const t0 = performance.now()`; chờ promise → 200 body đúng A1 và `performance.now() - t0 ≥ 45` (chờ promise, không `sleep`).
3. `Bearer app-mock-timeout` + body `{}` → **sau** ≥ 45 ms mới trả 400 `inputs is required` (không trả 400 ngay).

**F. Hub — `GET /health`**
1. Không token → 200 `{status:"ok", version:"mock"}`; token `mock-401` → vẫn 200; `X-Mock-Scenario: unauthorized` → vẫn 200; token `mock-timeout` → 200 và không chờ (< 45 ms) (health không qua middleware kịch bản).

**G. Hub — `POST /internal/test-run` (spec §3.3, hình tạm theo HUB-FR-51)**
1. `Bearer mock-ok` + `RUN_BODY` → 200 body đúng `{run_id:"00000000-0000-7000-8000-000000000001", status:"succeeded", output:{text:'mock:{"text":"a"}'}, ms:120, trace:[]}` (`toEqual`, có `trace: []`).
2. Không kiểm trường bên trong `command`: `command: {}` → 200 như G1.
3. Validate (400 `{error:{code:"VALIDATION_FAILED", message:<m>}}`, báo trường đầu tiên sai theo thứ tự `command` → `inputs`): `{}` → `command không hợp lệ`; `{inputs:{text:"a"}}` → `command không hợp lệ`; `command: null` / `[]` / `"x"` → `command không hợp lệ`; `{command:{}}` → `inputs không hợp lệ`; `{command:{}, inputs:[]}` → `inputs không hợp lệ`; body kiểu cũ `{workflow_id:"<uuid>", inputs:{text:"a"}}` → `command không hợp lệ`.
4. Body không phải JSON → như `{}` → 400 `command không hợp lệ`.
5. `Bearer mock-401`, thiếu `Authorization`, `Authorization: Basic YTpi` → 401 `H401` (kể cả body sai → 401, kịch bản thắng validate).

**H. Hub — `GET /agent-grants/effective/:user_id`**
1. `Bearer mock-ok`, `user_id = U` → 200 `{items:[{agent_id:"00000000-0000-7000-8000-0000000000a1", key:"invoice-checker", name:{vi:"Kiểm tra hoá đơn", en:"Invoice checker"}, reasons:["group:mock-group"]}]}`; `user_id` chữ hoa (`U.toUpperCase()`) → 200.
2. `user_id = "abc"` và `"00000000-0000-7000-8000-0000000000c"` (thiếu 1 ký tự) → 400 `{error:{code:"VALIDATION_FAILED", message:"user_id không hợp lệ"}}`.
3. `Bearer mock-401` → 401 `H401`.

**I. Hub — `X-Mock-Scenario` và `timeout`**
1. Như D1–D3 với token `mock-*` trên `POST /internal/test-run` (lạ/rỗng/sai hoa thường → bỏ qua, chọn theo token).
2. `Bearer mock-timeout` + `RUN_BODY` qua `Bun.serve({ port: 0, fetch: createHubMock({ timeoutMs: 50 }).fetch })` + `AbortSignal.timeout(20)` → reject (như E1); không huỷ → 200 body G1 sau ≥ 45 ms; `Bearer mock-timeout` + `{}` → 400 `command không hợp lệ` sau ≥ 45 ms.

Ghi chú: `timeoutMs` bắt buộc (spec §7, qc#8); không test giá trị mặc định 30000 ở in-process (thuộc `tools/mocks/src/env.test.ts` của backend-lead). Ngưỡng 45 ms (< 50) chừa sai số đồng hồ.

#### `tests/acceptance/ADM-NFR-06/i18n-check.test.ts`

Repo tạm (`makeRepo`), chạy `bun <ROOT>/tools/scripts/src/i18n-check.ts` với `cwd` = repo tạm (T-CLI-1), gộp stdout+stderr. Tên test `ADM-NFR-06 · M0-AC16 · …`. Theo T-I18N-1:
1. Không có `packages/i18n/locales/` → exit 0, đầu ra chứa `i18n:check: chưa có locale, bỏ qua`.
2. Có thư mục `packages/i18n/locales/` nhưng rỗng → như ca 1.
3. **Chỉ có `vi.json`** (`{"a":"x"}`) → exit 1, đầu ra chứa `i18n:check: thiếu packages/i18n/locales/en.json`; không chứa `chưa có locale, bỏ qua`.
4. **Chỉ có `en.json`** → exit 1, đầu ra chứa `i18n:check: thiếu packages/i18n/locales/vi.json`.
5. `vi.json` = `{"a":{"b":{"c":"x"}},"d":"y"}`, `en.json` cùng tập key (giá trị khác) → exit 0, không có dòng `MISSING_`.
6. `en.json` thiếu `a.b.c` → exit 1, đầu ra chứa `MISSING_en a.b.c`; không chứa `MISSING_vi`.
7. `vi.json` thiếu `d` → exit 1, `MISSING_vi d`.
8. Lệch cả hai phía (`vi` thiếu `d`, `en` thiếu `a.b.c`) → exit 1, có cả `MISSING_vi d` và `MISSING_en a.b.c`.
9. Key lồng sâu so theo key phẳng: `vi` `{"a":{"b":"x"}}` vs `en` `{"a":{"c":"x"}}` → `MISSING_en a.b` và `MISSING_vi a.c`.

Repo thật: `bun run i18n:check` exit 0 (mục 4 `ac16`).

## 4. Lệnh kiểm (chạy ở gốc repo, Git Bash; qc chạy ở VERIFY / T17 và CI)

```bash
# ac01 — cài đặt lặp lại được
rm -rf node_modules
out1=$(bun install 2>&1) && h1=$(sha256sum bun.lock) \
  && out2=$(bun install --frozen-lockfile 2>&1) && h2=$(sha256sum bun.lock) \
  && [ "$h1" = "$h2" ] && ! printf '%s\n%s\n' "$out1" "$out2" | grep -iE 'warn.*peer|peer.*(missing|warn)'

# ac02 — compose healthy trong 60 s
start=$(date +%s)
docker compose up -d --wait --wait-timeout 60 && [ $(( $(date +%s) - start )) -le 60 ] \
  && docker compose ps --format json | bun -e '
    const t = (await Bun.stdin.text()).trim();
    const rows = t.startsWith("[") ? JSON.parse(t) : t.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    const got = Object.fromEntries(rows.map((r) => [r.Service, r.Health]));
    const want = { mailpit: "healthy", postgres: "healthy", redis: "healthy" };
    if (JSON.stringify(Object.entries(got).sort()) !== JSON.stringify(Object.entries(want).sort())) { console.error(got); process.exit(1); }'

# ac03 — migrate trên DB dev
bun run db:migrate && bun run db:migrate \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system -Atc "select table_schema||'.'||table_name from information_schema.tables where table_schema in ('admin','hub') order by 1")" = "$(printf 'hub.agent_grants\nhub.agent_workflows\nhub.usage_logs')" ] \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system -Atc "select 1 from pg_namespace where nspname='admin'")" = "1" ] \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system -Atc "select count(*) from pg_roles where rolname in ('admin_rw','hub_ro')")" = "2" ]

# ac04 — migrate production trên DB test (đúng lệnh xong T7; không bao giờ chạy production lên DB dev)
export TEST_DATABASE_URL=${TEST_DATABASE_URL:-postgres://ai:ai_dev_pw@localhost:5432/ai_system_test}
bun -e 'await (await import("./packages/db/src/test-db.ts")).resetTestDb(process.env.TEST_DATABASE_URL)' \
  && APP_ENV=production DATABASE_URL=$TEST_DATABASE_URL bun packages/db/src/migrate.ts \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system_test -Atc "select nspname from pg_namespace where nspname in ('admin','hub') order by 1")" = "$(printf 'admin\nhub')" ] \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system_test -Atc "select count(*) from pg_roles where rolname in ('admin_rw','hub_ro')")" = "2" ] \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system_test -Atc "select count(*) from information_schema.tables where table_schema = 'hub'")" = "0" ] \
  && [ "$(docker compose exec -T postgres psql -U ai -d ai_system_test -Atc "select to_regclass('drizzle.__drizzle_migrations_dev') is null")" = "t" ]
# phần development trên DB test + các ca int còn lại
bun run test:int

# ac05
time bun run check            # exit 0, < 30 s

# ac06 — typecheck gồm tsconfig.tests.json ở gốc (qc#4); file thử ngoài tests/acceptance nên không vào lock
bun run typecheck \
  && printf 'import { khongCo } from "@ai/contracts";\nexport const z = khongCo;\n' > tests/zz-tmp.ts \
  && { bun run typecheck; rc=$?; rm -f tests/zz-tmp.ts; [ $rc -ne 0 ]; }

# ac07 — bun test không nạp e2e / *.int.test.ts; mỗi workspace có code có test
out=$(time bun test 2>&1); rc=$?; echo "$out"
[ $rc -eq 0 ] && ! echo "$out" | grep -E '^(\./)?e2e/|\.int\.test\.ts'
bun tests/acceptance/ADM-NFR-06/ac07.check.ts

# ac08/ac09 — server dev thật (bổ sung cho health.test.ts / server.int.test.ts); chờ theo điều kiện, hạn 10 s
PORT=3001 APP_ENV=development CORS_ORIGINS=http://localhost:3000 bun apps/admin-api/src/server.ts & pid=$!
timeout 10 bash -c 'until curl -sf localhost:3001/health >/dev/null; do sleep 0.2; done'; up=$?
curl -s -i localhost:3001/health | grep -qiE '^HTTP/1.1 200' \
  && curl -s -i localhost:3001/health | grep -qiE '^x-request-id: [A-Za-z0-9._-]+' \
  && [ "$(curl -s localhost:3001/health)" = '{"status":"ok","version":"0.0.0"}' ] \
  && [ "$(curl -s -o /dev/null -w '%{http_code}' localhost:3001/khong-co)" = "404" ] \
  && [ "$(curl -s localhost:3001/khong-co)" = '{"error":{"code":"NOT_FOUND","message":"Not found"}}' ]; rc=$?
kill $pid; [ $up -eq 0 ] && [ $rc -eq 0 ]

# ac10 — pre-commit chặn sai format (không để lại commit/file)
head=$(git rev-parse HEAD)
printf 'const  a=1\n' > tmp-bad.ts && git add tmp-bad.ts
out=$(git commit -m "test" 2>&1); rc=$?
git reset -q --mixed "$head"; rm -f tmp-bad.ts
[ $rc -ne 0 ] && echo "$out" | grep -qi 'format' && [ "$(git rev-parse HEAD)" = "$head" ]

# ac11 — check:size trên repo thật
for i in $(seq 401); do echo "export const x$i = 1;"; done > apps/admin-api/src/tmp-401.ts
out=$(bun run check:size 2>&1); rc=$?
for i in $(seq 400); do echo "export const x$i = 1;"; done > apps/admin-api/src/tmp-401.ts
bun run check:size; rc2=$?
rm -f apps/admin-api/src/tmp-401.ts
[ $rc -eq 1 ] && echo "$out" | grep -q 'apps/admin-api/src/tmp-401.ts: 401 dòng > 400' && [ $rc2 -eq 0 ]

# ac12 — depcruise bắt routes → repo; file untracked KHÔNG git add -N vẫn phải bị bắt (T-DEP-8)
d=apps/admin-api/src/modules/health
printf 'export const r = 1;\n' > $d/x.repo.ts
printf 'import { r } from "./x.repo";\nexport const a = r;\n' > $d/x.routes.ts
out=$(bun run depcruise 2>&1); rc=$?
rm -f $d/x.repo.ts $d/x.routes.ts
[ $rc -eq 1 ] && echo "$out" | grep -q 'no-routes-to-repo' && bun run depcruise

# ac13 — lock trên repo thật (qc chạy sau LOCK)
bun run test:lock:verify                       # exit 0, 'test:lock OK (<n> file)'
f=$(git ls-files tests/acceptance | head -n1); cp "$f" "$f.bak"; printf ' ' >> "$f"
out=$(bun run test:lock:verify 2>&1); rc=$?
mv "$f.bak" "$f"
[ $rc -eq 1 ] && echo "$out" | grep -q "CHANGED $f" && bun run test:lock:verify

# ac14 — trace trên repo thật (phần mở đầu TRACE.md không bị xoá, T-TRACE-4)
bun run trace && grep -q 'ADM-NFR-06' docs/TRACE.md \
  && ! git diff docs/TRACE.md | grep -q '^-Sinh tự động' \
  && bun run trace ADM-NFR-06 | grep -q 'docs/specs/M0-bootstrap/spec.md' \
  && ! bun run trace ADM-FR-999 && bun run trace --check

# ac15 — mock chạy thật (token 401, token ok, Hub test-run mới); chờ theo điều kiện, hạn 10 s
bun tools/mocks/src/server.ts & pid=$!
timeout 10 bash -c 'until curl -sf localhost:4020/health >/dev/null && curl -s -o /dev/null localhost:4010/v1/parameters; do sleep 0.2; done'; up=$?
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST localhost:4010/v1/workflows/run -H 'Authorization: Bearer app-mock-401' -d '{}')" = "401" ] \
  && [ "$(curl -s -X POST localhost:4010/v1/workflows/run -H 'Authorization: Bearer app-mock-401' -d '{}')" = '{"code":"unauthorized","message":"Access token is invalid","status":401}' ] \
  && curl -s -X POST localhost:4010/v1/workflows/run -H 'Authorization: Bearer app-mock-ok' -H 'Content-Type: application/json' \
       -d '{"inputs":{"text":"a"},"response_mode":"blocking","user":"u1"}' | grep -q '"status":"succeeded"' \
  && curl -s -X POST localhost:4020/internal/test-run -H 'Authorization: Bearer mock-ok' -H 'Content-Type: application/json' \
       -d '{"command":{},"inputs":{"text":"a"}}' | grep -q '"trace":\[\]'; rc=$?
kill $pid; [ $up -eq 0 ] && [ $rc -eq 0 ]

# ac16
bun run i18n:check

# ac17 — cú pháp YAML (nội dung bước do ci-workflow.test.ts kiểm)
bun -e "Bun.YAML.parse(await Bun.file('.github/workflows/ci.yml').text())"

# ac18 — e2e smoke (webServer do playwright.config.ts dựng)
bunx playwright install chromium && bunx playwright test e2e/smoke.spec.ts

# ac19 — ngân sách bundle
bun run --filter @ai/admin-web build && bun run --filter @ai/admin-web check:bundle
```

`tests/acceptance/ADM-NFR-06/ac07.check.ts` (không phải test của bun):

```ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../../..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { workspaces: string[] };
const SKIP = new Set(["packages/config"]); // không có code
const isTest = (f: string) => /\.(test|spec)\.tsx?$/.test(f);
const isCode = (f: string) => /\.tsx?$/.test(f) && !isTest(f) && !/\.d\.ts$|\.gen\.ts$/.test(f);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    if (n === "node_modules" || n === "dist" || n === "__fixtures__") return [];
    const p = join(dir, n);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

const dirs = pkg.workspaces.flatMap((g) => {
  const base = g.replace(/\/\*$/, "");
  return readdirSync(join(ROOT, base)).map((n) => `${base}/${n}`);
});
const missing: string[] = [];
for (const d of dirs) {
  if (SKIP.has(d) || !existsSync(join(ROOT, d, "package.json"))) continue;
  const files = walk(join(ROOT, d));
  if (files.some(isCode) && !files.some(isTest)) missing.push(d);
}
if (missing.length) {
  console.error(`Workspace có code nhưng chưa có test: ${missing.join(", ")}`);
  process.exit(1);
}
console.log(`ac07.check OK (${dirs.length} workspace)`);
```

## 5. Độ phủ

- FR MUST: **0/0** (M0 không có FR nghiệp vụ; `ADM-NFR-06` ưu tiên `—` nên `trace --check` không chặn theo nó).
- AC trong `spec.md` §8: **19/19** có cách kiểm tự động rõ ràng — bun test (acceptance/int): AC03, 04, 08, 09, 11, 13, 14, 15, 16, 17; e2e: AC18; lệnh kiểm mục 4: AC01, 02, 05, 06, 07, 10, 12, 19 (AC03, 04, 08, 09, 11, 13, 14, 15, 16 có cả hai).
- Số file khoá dự kiến (khớp `tasks.md` Q2/Q3): 11 file `tests/acceptance/ADM-NFR-06/**` (`_helpers.ts`, `health.test.ts`, `server.int.test.ts`, `migrate.int.test.ts`, `check-size.test.ts`, `test-lock.test.ts`, `trace.test.ts`, `ci-workflow.test.ts`, `mocks.test.ts`, `i18n-check.test.ts`, `ac07.check.ts`) + `e2e/smoke.spec.ts` = 12 → `test:lock OK (12 file)` (con số thật chốt lúc LOCK).
- Trạng thái kỳ vọng trước BUILD: tất cả đỏ vì thiếu code (import không resolve, script chưa có). `tsc -p tsconfig.tests.json` (T19) chỉ chạy được sau T3/T8/T9/FE-5 (cần `@ai/contracts`, `@ai/db`, `tools/mocks`, `@playwright/test`); trước đó qc kiểm cú pháp test bằng `bunx tsc --noEmit -p tsconfig.tests.json` ngay khi file này có.

## 6. Cần bổ sung (agent: việc)

### 6.1 Đã giải quyết ở vòng 1 → spec §9 (giữ số để tham chiếu `qc#n`)

| # | Chủ đề | Chốt tại | Áp vào test-plan |
|---|---|---|---|
| 1 | AC01 "không cảnh báo peer" | §8 AC01, qc#1 | mục 4 `ac01` |
| 2 | AC02 đo 60 s, `ps` mảng/NDJSON | §8 AC02, qc#2 | mục 4 `ac02` |
| 3 | `runMigrations` trả số migration vừa áp | §8 AC03/04, qc#3 | `migrate.int.test.ts` |
| 4 | typecheck phủ test: `tsconfig.tests.json` **ở gốc** (không phải `tests/tsconfig.json`); devDeps gốc `postgres` 3.4.9, `@ai/contracts`, `@ai/db`, `@playwright/test` 1.63.0 | §8 AC06, qc#4, T19 | mục 2 AC06, mục 4 `ac06` |
| 5 | depcruise bắt file untracked, không `--affected` | T-DEP-8, qc#5 | mục 4 `ac12` bỏ `git add -N` |
| 6 | gốc repo theo `cwd`; OK ra stdout, lỗi ra stderr; test gộp hai kênh | T-CLI-1, qc#6 | `_helpers.run` |
| 7 | nhánh 500 qua `version` sai định dạng | §3.1, qc#7 | `health.test.ts` |
| 8 | `createDifyMock/createHubMock({ timeoutMs })` bắt buộc | §7, qc#8 | mục 3.10 |
| 9 | Dify báo trường đầu tiên sai; `response_mode must be blocking` | §3.2, qc#9 | mục 3.10 C (nay kiểm cả message) |
| 10 | chỉ có một file locale → exit 1 `i18n:check: thiếu packages/i18n/locales/<lang>.json` | T-I18N-1, qc#10 | mục 3.10 `i18n-check` ca 3, 4 |
| 11 | giữ nguyên phần mở đầu trước `\| FR \|` | T-TRACE-4, qc#11 | `trace.test.ts` |
| 12 | cách kiểm AC07 khi R3 | qc#12 | giữ |
| 13 | Q2/Q3 đủ 12 file khoá | qc#13, tasks.md | mục 5 |
| 14 | AC18, AC19 chính thức | §8, qc#14 | mục 2, 3.9, 4 |
| 16 | nhãn e2e theo `plan-frontend.md` §5 | qc#16 | mục 3.9 |
| r#5 | test chỉ tính theo path/tên test, bỏ `__fixtures__` | T-TRACE-2 | `trace.test.ts` + quy ước mục 1 |
| r#11, r#15 | Hub `test-run` `{command, inputs}` + `trace: []`; T-MOCK-1 | §3.3, T-MOCK-1 | mục 3.10 D, G, I |
| r#1 | lệnh migrate/psql trên DB test | T7 | mục 4 `ac04` |

### 6.2 Còn mở

1. **ba · ADM-NFR-06** (qc#15, không chặn M0): M0 chỉ phủ vế "migration có version"; seed (`platform`, `core`, `platform_admin` đầu tiên) thuộc M1. Sau M0 `trace` sẽ báo `ADM-NFR-06` là `có test` dù seed chưa có. Việc: BA ghi chú phạm vi hoặc tách mã khi làm spec M1 (D1 đã ghi chú); qc M1 thêm test seed trước khi coi NFR-06 xong.
2. **backend-lead · T-MOCK-1** (thấp, mặc định sẵn): `Authorization: Bearer` (có tiền tố, không có token) — qc coi là "không dạng `Bearer <token>`" → `unauthorized` (mục 3.10 B3). Khác ý thì báo trước LOCK.
3. **backend-lead · huỷ timeout** (thấp): ca huỷ phía client chạy mock qua `Bun.serve({ port: 0, fetch: app.fetch })` vì `app.request` in-process không huỷ được handler; yêu cầu `createDifyMock/createHubMock` trả `Hono` (có `.fetch`) đúng plan.md.

Đã đối chiếu: không AC nào "không kiểm được tự động"; AC10 và AC17 được tự động hoá như mục 2–4, bản thủ công chỉ còn là dự phòng.
