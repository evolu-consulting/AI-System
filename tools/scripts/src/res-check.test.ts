import { describe, expect, test } from "bun:test";
import {
  PS_LOCAL_SCRIPT,
  parseLocalPs,
  parseServerOut,
  parseWorktreeList,
  serverScript,
} from "./res-check.parse";
import {
  countHeavy,
  DEFAULTS,
  formatReport,
  hardLimits,
  type LocalMetrics,
  procClass,
  recommend,
  type ServerMetrics,
} from "./res-check.rules";

const heavy0 = { postgres: 1, playwright: 0, chromium: 0, bunTest: 0, nodeDev: 0 };
const local = (o: Partial<LocalMetrics> = {}): LocalMetrics => ({
  cores: 16,
  load: 2,
  freeRamMb: 12 * 1024,
  totalRamMb: 32 * 1024,
  freeDiskGb: 80,
  heavy: { ...heavy0 },
  worktrees: { total: 2, stale: 0, orphans: 0 },
  lanes: 2,
  ...o,
});
const server = (o: Partial<ServerMetrics> = {}): ServerMetrics => ({
  cores: 8,
  load1: 1,
  freeRamMb: 16 * 1024,
  totalRamMb: 32 * 1024,
  freeDiskGb: 200,
  containers: 3,
  slotsBusy: [false, true, false, false],
  ...o,
});

describe("res-check rules · khuyến nghị", () => {
  test("máy rảnh: nhiều agent, 2 Playwright, không cảnh báo", () => {
    const r = recommend(local(), server());
    expect(r.maxAgents).toBe(8);
    expect(r.maxPlaywright).toBe(2);
    expect(r.serverSlots).toBe(3);
    expect(r.warnings).toEqual([]);
    expect(r.hard).toEqual([]);
  });

  test("RAM 7 GB trống ⇒ agent theo RAM (5), Playwright 2; RAM 4,5 GB ⇒ 1", () => {
    expect(recommend(local({ freeRamMb: 7 * 1024 })).maxAgents).toBe(5);
    expect(recommend(local({ freeRamMb: 7 * 1024 })).maxPlaywright).toBe(2);
    expect(recommend(local({ freeRamMb: 4.5 * 1024 })).maxPlaywright).toBe(1);
  });

  test("RAM < 4 GB: cảnh báo + Playwright 0; < 2 GB: giới hạn cứng", () => {
    const r = recommend(local({ freeRamMb: 3 * 1024 }));
    expect(r.maxPlaywright).toBe(0);
    expect(r.warnings.some((w) => w.includes("RAM trống"))).toBe(true);
    expect(r.hard).toEqual([]);
    const h = recommend(local({ freeRamMb: 1024 }));
    expect(h.hard.length).toBe(1);
    expect(h.maxAgents).toBe(0);
  });

  test("đĩa < 30 GB cảnh báo + giới hạn agent 3; < 15 GB cứng + Playwright 0", () => {
    const w = recommend(local({ freeDiskGb: 25 }));
    expect(w.maxAgents).toBe(3);
    expect(w.warnings.some((x) => x.includes("đĩa"))).toBe(true);
    expect(w.hard).toEqual([]);
    const h = recommend(local({ freeDiskGb: 10 }));
    expect(h.maxAgents).toBe(1);
    expect(h.maxPlaywright).toBe(0);
    expect(hardLimits(local({ freeDiskGb: 10 }))).toHaveLength(1);
    expect(hardLimits(local({ freeDiskGb: 15 }))).toEqual([]);
  });

  test("tải CPU cao: ít agent hơn, không Playwright, cảnh báo", () => {
    const r = recommend(local({ load: 15 }));
    expect(r.maxAgents).toBe(1);
    expect(r.maxPlaywright).toBe(0);
    expect(r.warnings.some((x) => x.includes("CPU"))).toBe(true);
  });

  test("Playwright đang chạy được trừ khỏi phần còn lại", () => {
    const r = recommend(local({ heavy: { ...heavy0, playwright: 1 } }));
    expect(r.maxPlaywright).toBe(1);
    expect(recommend(local({ heavy: { ...heavy0, playwright: 2 } })).maxPlaywright).toBe(0);
  });

  test("worktree dư > ngưỡng và Postgres tắt ⇒ cảnh báo", () => {
    const r = recommend(
      local({ worktrees: { total: 6, stale: 3, orphans: 1 }, heavy: { ...heavy0, postgres: 0 } }),
    );
    expect(r.warnings.some((x) => x.includes("worktree"))).toBe(true);
    expect(r.warnings.some((x) => x.includes("Postgres"))).toBe(true);
    expect(recommend(local({ worktrees: { total: 6, stale: 3, orphans: 0 } })).warnings).toEqual(
      [],
    );
  });

  test("server: bận hết ⇒ 0 slot + cảnh báo xếp hàng; quá tải ⇒ tối đa 1", () => {
    const busy = recommend(local(), server({ slotsBusy: [true, true, true, true] }));
    expect(busy.serverSlots).toBe(0);
    expect(busy.warnings.some((x) => x.includes("xếp hàng"))).toBe(true);
    const loaded = recommend(local(), server({ load1: 12 }));
    expect(loaded.serverSlots).toBe(1);
    expect(loaded.warnings.some((x) => x.includes("quá tải"))).toBe(true);
  });

  test("không --server ⇒ serverSlots null", () => {
    expect(recommend(local()).serverSlots).toBeNull();
  });

  test("formatReport có bảng + KHUYẾN NGHỊ + cảnh báo", () => {
    const l = local({ freeDiskGb: 10 });
    const s = server();
    const txt = formatReport(l, s, recommend(l, s)).join("\n");
    expect(txt).toContain("KHUYẾN NGHỊ");
    expect(txt).toContain("SERVER slot");
    expect(txt).toContain("GIỚI HẠN CỨNG");
    expect(DEFAULTS.diskHardGb).toBe(15);
  });
});

describe("res-check rules · phân loại tiến trình", () => {
  test("postgres chỉ đếm tiến trình chính, không đếm backend", () => {
    expect(
      procClass({ name: "postgres.exe", cmd: '"C:\\pg\\bin\\postgres.exe" -D data -p 5433' }),
    ).toBe("postgres");
    expect(
      procClass({
        name: "postgres.exe",
        cmd: '"C:\\pg\\bin\\postgres.exe" --forkchild=backend 123',
      }),
    ).toBeUndefined();
  });

  test("chromium headless của Playwright, bỏ qua tiến trình con và Chrome thường", () => {
    const main = '"C:\\ms-playwright\\chromium-1\\chrome.exe" --headless --remote-debugging-pipe';
    expect(procClass({ name: "chrome.exe", cmd: main })).toBe("chromium");
    expect(procClass({ name: "chrome.exe", cmd: `${main} --type=renderer` })).toBeUndefined();
    expect(procClass({ name: "chrome.exe", cmd: '"C:\\Chrome\\chrome.exe"' })).toBeUndefined();
  });

  test("playwright / bun test / dev server", () => {
    expect(
      procClass({
        name: "node.exe",
        cmd: 'node "x\\node_modules\\playwright\\cli.js" test -c e2e/a.config.ts',
      }),
    ).toBe("playwright");
    expect(procClass({ name: "bun.exe", cmd: "bun tools/scripts/src/run-playwright.ts" })).toBe(
      "playwright",
    );
    expect(
      procClass({
        name: "bun.exe",
        cmd: "bun --config=bunfig.int.toml test --timeout 30000 .int.test",
      }),
    ).toBe("bunTest");
    expect(procClass({ name: "bun.exe", cmd: "bun tools/scripts/src/test-int-par.ts" })).toBe(
      "bunTest",
    );
    expect(procClass({ name: "node.exe", cmd: "node node_modules/.bin/rsbuild dev" })).toBe(
      "nodeDev",
    );
    expect(procClass({ name: "bun.exe", cmd: "bun run --hot src/server.ts" })).toBe("nodeDev");
    expect(procClass({ name: "node.exe", cmd: "node some-other.js" })).toBeUndefined();
    expect(procClass({ name: "explorer.exe", cmd: "" })).toBeUndefined();
  });

  test("countHeavy", () => {
    const h = countHeavy([
      { name: "postgres.exe", cmd: "postgres -D d" },
      { name: "postgres.exe", cmd: "postgres --forkchild=x" },
      { name: "bun.exe", cmd: "bun test a.test.ts" },
      { name: "node.exe", cmd: "playwright/cli.js test" },
    ]);
    expect(h).toEqual({ postgres: 1, playwright: 1, chromium: 0, bunTest: 1, nodeDev: 0 });
  });
});

describe("res-check parse · mẫu đầu ra", () => {
  test("PowerShell JSON (mảng, một phần tử, BOM/rác đầu)", () => {
    const sample =
      '{"cores":16,"cpu":12.5,"freeKb":7340032,"totalKb":33554432,"disk":79339839488,"procs":[{"n":"postgres.exe","c":"postgres -D d"},{"n":"bun.exe","c":null}]}';
    const r = parseLocalPs(`\uFEFF${sample}\r\n`);
    expect(r?.cores).toBe(16);
    expect(r?.cpuPct).toBe(12.5);
    expect(r?.freeRamMb).toBe(7168);
    expect(r?.totalRamMb).toBe(32768);
    expect(r?.freeDiskGb).toBeCloseTo(73.89, 1);
    expect(r?.procs).toEqual([
      { name: "postgres.exe", cmd: "postgres -D d" },
      { name: "bun.exe", cmd: "" },
    ]);
    const one = parseLocalPs(
      '{"cores":4,"cpu":0,"freeKb":1024,"totalKb":2048,"disk":0,"procs":{"n":"node.exe","c":"x"}}',
    );
    expect(one?.procs).toEqual([{ name: "node.exe", cmd: "x" }]);
    expect(
      parseLocalPs('{"cores":4,"cpu":0,"freeKb":1,"totalKb":2,"disk":0,"procs":null}')?.procs,
    ).toEqual([]);
  });

  test("PowerShell rác/rỗng ⇒ undefined", () => {
    expect(parseLocalPs("")).toBeUndefined();
    expect(parseLocalPs("Get-CimInstance : lỗi")).toBeUndefined();
    expect(parseLocalPs("{broken")).toBeUndefined();
    expect(parseLocalPs('{"cores":0,"totalKb":0}')).toBeUndefined();
  });

  test("ssh khoá=giá trị ⇒ ServerMetrics (CRLF, banner thừa)", () => {
    const out = [
      "Welcome to Ubuntu",
      "nproc=8",
      "load1=0.42",
      "mem_avail_kb=16777216",
      "mem_total_kb=33554432",
      "disk_free_kb=209715200",
      "containers=5",
      "slot1=busy",
      "slot2=free",
      "slot3=free",
      "slot4=busy",
    ].join("\r\n");
    const s = parseServerOut(out);
    expect(s).toEqual({
      cores: 8,
      load1: 0.42,
      freeRamMb: 16384,
      totalRamMb: 32768,
      freeDiskGb: 200,
      containers: 5,
      slotsBusy: [true, false, false, true],
    });
  });

  test("ssh thiếu khoá/lỗi kết nối ⇒ undefined", () => {
    expect(parseServerOut("")).toBeUndefined();
    expect(
      parseServerOut("ssh: connect to host 149.202.83.5 port 22: Connection timed out"),
    ).toBeUndefined();
    expect(parseServerOut("nproc=8\nload1=1")).toBeUndefined();
  });

  test("git worktree list --porcelain", () => {
    const t =
      "worktree F:/workspace/evolu-platform\nHEAD abc\nbranch refs/heads/platform/gd0\n\nworktree F:/workspace/evolu-wt/a\nHEAD def\nbranch refs/heads/slice/a\n\nworktree F:/x/det\nHEAD 123\ndetached\n";
    expect(parseWorktreeList(t)).toEqual([
      { path: "F:/workspace/evolu-platform", branch: "platform/gd0" },
      { path: "F:/workspace/evolu-wt/a", branch: "slice/a" },
      { path: "F:/x/det" },
    ]);
  });

  test("script chỉ gồm lệnh đọc và số slot đúng; script PS thay được ổ đĩa", () => {
    const s = serverScript(4);
    expect(s).toContain("seq 1 4");
    expect(s).not.toMatch(/\b(rm|mkdir|kill|docker (stop|rm|run)|mv)\b/);
    expect(PS_LOCAL_SCRIPT).toContain("{DRIVE}");
    expect(PS_LOCAL_SCRIPT).not.toMatch(/Remove-|Stop-|Set-|New-Item/);
  });
});
