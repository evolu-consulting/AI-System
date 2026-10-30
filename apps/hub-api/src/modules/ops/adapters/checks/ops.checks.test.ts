// CR-104 · ops-checks · unit: phần đánh giá thuần của 7 check (không DB, không mạng) + helper đọc file trạng thái/làm sạch chuỗi.
// Check mạng chạy với `fetch`/hàm TLS tiêm vào (không ra Internet).
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OPS_DEFAULT_SETTINGS, OpsBackupStatusSchema } from "@ai/contracts/hub-admin";
import type { OpsCheckDeps } from "../../application/ops.check";
import { evaluateBackup } from "./backup.check";
import { publicUrlsFromEnv, readStatusFile, scrub } from "./check-kit";
import { evaluateDisk } from "./disk.check";
import { evaluateProvider, HINT_LOGGED_OUT, type ProviderRow } from "./provider.check";
import { evaluatePublicHosts, makePublicHostsCheck } from "./public-hosts.check";
import { evaluateRunsFailed } from "./runs-failed.check";
import { evaluateStuck } from "./stuck.check";
import { evaluateTls, makeTlsCheck } from "./tls.check";

const NOW = new Date("2026-10-30T12:00:00Z");
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const prov = (
  key: string,
  status: ProviderRow["status"],
  min = 0,
  err: string | null = null,
): ProviderRow => ({
  provider_key: key,
  status,
  updated_at: ago(min),
  last_error: err,
});

describe("provider", () => {
  it("logged_out ⇒ crit + gợi ý đăng nhập lại Claude CLI", () => {
    const r = evaluateProvider([prov("claude", "logged_out")], NOW, 30);
    expect(r.status).toBe("crit");
    expect(r.hint).toBe(HINT_LOGGED_OUT);
  });
  it("không provider nào ok ⇒ crit; còn một ok + một cooldown ngắn ⇒ ok", () => {
    expect(evaluateProvider([prov("a", "cooldown"), prov("b", "busy")], NOW, 30).status).toBe(
      "crit",
    );
    expect(evaluateProvider([prov("a", "ok"), prov("b", "cooldown", 5)], NOW, 30).status).toBe(
      "ok",
    );
  });
  it("cooldown quá warn phút ⇒ warn", () => {
    expect(evaluateProvider([prov("a", "ok"), prov("b", "cooldown", 31)], NOW, 30).status).toBe(
      "warn",
    );
  });
  it("không lộ last_error nguyên văn (token, đường dẫn)", () => {
    const r = evaluateProvider(
      [prov("a", "error", 0, "ENOENT /home/app/.claude/creds.json Bearer sk-abcdef1234567890 xyz")],
      NOW,
      30,
    );
    expect(r.message).not.toContain("/home/app");
    expect(r.message).not.toContain("sk-abcdef");
    expect(scrub("x".repeat(300)).length).toBeLessThanOrEqual(81);
  });
  it("rỗng ⇒ unknown", () => expect(evaluateProvider([], NOW, 30).status).toBe("unknown"));
});

describe("runs_failed", () => {
  it("dưới 10 run ⇒ không tính %", () =>
    expect(evaluateRunsFailed({ total: 9, failed: 9, exhausted: 0 }, 20, 0).status).toBe("ok"));
  it("≥ 10 run, 30% failed ⇒ warn; 10% ⇒ ok", () => {
    expect(evaluateRunsFailed({ total: 10, failed: 3, exhausted: 0 }, 20, 0).status).toBe("warn");
    expect(evaluateRunsFailed({ total: 10, failed: 1, exhausted: 0 }, 20, 0).status).toBe("ok");
  });
  it("ALL_PROVIDERS_EXHAUSTED ⇒ crit dù ít run", () =>
    expect(evaluateRunsFailed({ total: 2, failed: 1, exhausted: 1 }, 20, 0).status).toBe("crit"));
});

describe("stuck", () => {
  it("ngưỡng warn > 0, crit > 5", () => {
    expect(evaluateStuck({ orphaned: 0, overdue_runs: 0 }, 0, 5).status).toBe("ok");
    expect(evaluateStuck({ orphaned: 1, overdue_runs: 0 }, 0, 5).status).toBe("warn");
    expect(evaluateStuck({ orphaned: 3, overdue_runs: 3 }, 0, 5).status).toBe("crit");
  });
});

const goodBackup = {
  finished_at: ago(60),
  ok: true,
  dir: "/b",
  size_bytes: 10,
  offsite: true,
  offsite_ok: true,
  error: null,
};
const okFile = <T>(data: T) => ({ kind: "ok", data }) as const;

describe("backup", () => {
  it("mới + offsite ⇒ ok", () =>
    expect(evaluateBackup(okFile(goodBackup), NOW, 26).status).toBe("ok"));
  it("thiếu file ⇒ crit; sai định dạng ⇒ unknown", () => {
    expect(evaluateBackup({ kind: "missing" }, NOW, 26).status).toBe("crit");
    expect(evaluateBackup({ kind: "invalid", reason: "x" }, NOW, 26).status).toBe("unknown");
  });
  it("quá 26 giờ hoặc ok=false ⇒ crit", () => {
    expect(
      evaluateBackup(okFile({ ...goodBackup, finished_at: ago(27 * 60) }), NOW, 26).status,
    ).toBe("crit");
    expect(
      evaluateBackup(okFile({ ...goodBackup, ok: false, error: "disk full" }), NOW, 26).status,
    ).toBe("crit");
  });
  it("local ok + offsite_ok=false ⇒ warn (không crit)", () =>
    expect(evaluateBackup(okFile({ ...goodBackup, offsite_ok: false }), NOW, 26).status).toBe(
      "warn",
    ));
  it("offsite=false ⇒ warn", () =>
    expect(
      evaluateBackup(okFile({ ...goodBackup, offsite: false, offsite_ok: null }), NOW, 26).status,
    ).toBe("warn"));
});

const host = (disks: { mount: string; used_pct: number }[], at = ago(10)) =>
  okFile({ at, disks: disks.map((d) => ({ ...d, avail_bytes: 1 })), deploy_ref: null });
describe("disk", () => {
  it("lấy đĩa đầy nhất: 85% ⇒ warn, 95% ⇒ crit, 50% ⇒ ok", () => {
    expect(
      evaluateDisk(
        host([
          { mount: "/", used_pct: 50 },
          { mount: "/data", used_pct: 85 },
        ]),
        NOW,
        30,
        80,
        90,
      ).status,
    ).toBe("warn");
    expect(evaluateDisk(host([{ mount: "/", used_pct: 95 }]), NOW, 30, 80, 90).status).toBe("crit");
    expect(evaluateDisk(host([{ mount: "/", used_pct: 50 }]), NOW, 30, 80, 90).status).toBe("ok");
  });
  it("file cũ hơn 2× tần suất ⇒ unknown", () =>
    expect(
      evaluateDisk(host([{ mount: "/", used_pct: 50 }], ago(66)), NOW, 30, 80, 90).status,
    ).toBe("unknown"));
  it("cron 30 phút: file 61 phút chưa cũ (ngưỡng ≥ 65); every_min của host nâng ngưỡng; value có deploy_ref", () => {
    const f61 = host([{ mount: "/", used_pct: 50 }], ago(61));
    const r = evaluateDisk(f61, NOW, 5, 80, 90);
    expect(r.status).toBe("ok");
    expect((r.value as { deploy_ref: string | null }).deploy_ref).toBeNull();
    const withRef = okFile({ ...f61.data, deploy_ref: "v1.2.3" });
    expect((evaluateDisk(withRef, NOW, 5, 80, 90).value as { deploy_ref: string }).deploy_ref).toBe(
      "v1.2.3",
    );
    const slow = okFile({ ...f61.data, at: ago(100), every_min: 60 });
    expect(evaluateDisk(slow, NOW, 5, 80, 90).status).toBe("ok");
  });
});

describe("scrub", () => {
  it("che khoá=giá trị, Bearer, user:pass@ trong URL, email, hex/base64 dài", () => {
    const s = scrub(
      "token=abc123 password: hunter2 api_key='k-1' Bearer eyJhbGci.x https://bob:pw123@host.test/x mail a.b@corp.vn " +
        "deadbeefdeadbeef0123 QUJDREVGR0hJSktMTU5PUA1234==",
      400,
    );
    for (const leak of [
      "abc123",
      "hunter2",
      "k-1",
      "eyJhbGci",
      "pw123",
      "a.b@corp",
      "deadbeefdead",
      "QUJDREVG",
    ])
      expect(s).not.toContain(leak);
    expect(s).toContain("host.test");
  });
  it("giữ nguyên câu lỗi thường", () => expect(scrub("not logged in")).toBe("not logged in"));
});

describe("file trạng thái", () => {
  const dir = mkdtempSync(join(tmpdir(), "ops-status-"));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  it("đọc đúng, thiếu, hỏng, sai schema", async () => {
    writeFileSync(join(dir, "backup.json"), JSON.stringify(goodBackup));
    writeFileSync(join(dir, "bad.json"), "{không phải json");
    writeFileSync(join(dir, "wrong.json"), JSON.stringify({ ok: "yes" }));
    expect(
      (await readStatusFile({ statusDir: dir }, "backup.json", OpsBackupStatusSchema)).kind,
    ).toBe("ok");
    expect(
      (await readStatusFile({ statusDir: dir }, "none.json", OpsBackupStatusSchema)).kind,
    ).toBe("missing");
    expect((await readStatusFile({ statusDir: dir }, "bad.json", OpsBackupStatusSchema)).kind).toBe(
      "invalid",
    );
    expect(
      (await readStatusFile({ statusDir: dir }, "wrong.json", OpsBackupStatusSchema)).kind,
    ).toBe("invalid");
  });
});

describe("public_hosts", () => {
  const p = (ok: boolean) => ({ host: "ai.example", ok, detail: ok ? "HTTP 200" : "quá giờ" });
  it("lượt lỗi đầu ⇒ warn, lượt thứ hai liền ⇒ crit, hồi phục ⇒ ok + đếm về 0", () => {
    expect(evaluatePublicHosts([p(false)], 0, 1, 2).status).toBe("warn");
    expect(evaluatePublicHosts([p(false)], 1, 1, 2).status).toBe("crit");
    const ok = evaluatePublicHosts([p(true)], 5, 1, 2);
    expect(ok.status).toBe("ok");
    expect((ok.value as { consecutive: number }).consecutive).toBe(0);
  });

  const urls = () =>
    publicUrlsFromEnv({ OPS_PUBLIC_URLS: " https://a.test/ , http://b.test/x ,rác" });
  const deps = (f: typeof fetch, prev?: OpsCheckDeps["prev"]): OpsCheckDeps =>
    ({
      fetch: f,
      now: NOW,
      signal: new AbortController().signal,
      ...(prev ? { prev } : {}),
    }) as OpsCheckDeps;
  const cfg = OPS_DEFAULT_SETTINGS.checks.public_hosts;
  const fetchBy = (bad: string) =>
    (async (u: string) =>
      new Response("x", {
        status: String(u).includes(bad) ? 503 : 200,
      })) as unknown as typeof fetch;

  it("fetch tiêm vào: host 503 ⇒ warn; lượt trước đã lỗi (prev) ⇒ crit", async () => {
    const c = makePublicHostsCheck(urls);
    const r1 = await c.run(deps(fetchBy("b.test")), cfg, OPS_DEFAULT_SETTINGS);
    expect(r1.status).toBe("warn");
    const r2 = await c.run(
      deps(fetchBy("b.test"), { public_hosts: { status: "warn", value: r1.value } }),
      cfg,
      OPS_DEFAULT_SETTINGS,
    );
    expect(r2.status).toBe("crit");
  });
  it("fetch ném lỗi ⇒ host lỗi; không có URL ⇒ unknown 'chưa cấu hình'", async () => {
    const boom = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    expect(
      (await makePublicHostsCheck(urls).run(deps(boom), cfg, OPS_DEFAULT_SETTINGS)).status,
    ).toBe("warn");
    const none = await makePublicHostsCheck(() => []).run(deps(boom), cfg, OPS_DEFAULT_SETTINGS);
    expect(none.status).toBe("unknown");
    expect(none.message).toBe("chưa cấu hình");
  });
});

describe("tls", () => {
  it("ngưỡng ngày: 20 ⇒ ok, 10 ⇒ warn, 2 ⇒ crit, hết hạn ⇒ crit", () => {
    const one = (days: number) => evaluateTls([{ host: "h", days }], 14, 3).status;
    expect([one(20), one(10), one(2), one(-1)]).toEqual(["ok", "warn", "crit", "crit"]);
  });
  it("hàm TLS tiêm vào: lấy host https xấu nhất, bỏ host http", async () => {
    const days = (n: number) => new Date(NOW.getTime() + n * 86_400_000 + 3_600_000);
    const c = makeTlsCheck(
      async (h) => {
        if (h === "dead.test") throw new Error("down");
        return h === "a.test" ? days(30) : days(5);
      },
      () =>
        publicUrlsFromEnv({
          OPS_PUBLIC_URLS: "https://a.test,https://b.test,https://dead.test,http://c.test",
        }),
    );
    const r = await c.run(
      { now: NOW, signal: new AbortController().signal } as OpsCheckDeps,
      OPS_DEFAULT_SETTINGS.checks.tls,
      OPS_DEFAULT_SETTINGS,
    );
    expect(r.status).toBe("warn");
    expect((r.value as { min_days: number }).min_days).toBe(5);
  });
});
