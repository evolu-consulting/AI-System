// CR-115 · luật khoá evotest (deploy/evotest/lock.sh + boot.sh): chạy bash THẬT trên thư mục tạm. Chỉ Linux/macOS (cần /proc, kill -0);
// trên Windows bỏ qua, chạy ở evotest (`run-tests.ps1 -Step int -Filter tools/scripts/src/evotest-lock.int.test.ts`).
import { describe, expect, it } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const DIR = resolve(import.meta.dir, "../../../deploy/evotest");
const LOCK = join(DIR, "lock.sh");
const BOOT = join(DIR, "boot.sh");
const ok = process.platform === "linux" && Bun.which("bash") !== null;
const d = ok ? describe : describe.skip;

const tmp = (): string => mkdtempSync(join(tmpdir(), "evo-lock-"));

/** Chạy đoạn bash đã `source` lock.sh với R=thư mục tạm, 4 slot, nhịp ngắn. Trả {rc, out}. */
function sh(r: string, script: string, env: Record<string, string> = {}) {
  const p = Bun.spawnSync(["bash", "-c", `. "${LOCK}"\n${script}`], {
    env: { ...process.env, R: r, N: "4", EVO_POLL_S: "0.05", EVO_PROGRESS_S: "1", ...env },
  });
  return { rc: p.exitCode, out: p.stdout.toString() + p.stderr.toString() };
}

/** Khoá giả do một tiến trình sống giữ: `holder <dir> <giây>` (sleep nền, ghi owner). */
const HOLD = `holder() { mkdir -p "$1"; sleep "$2" & HP=$!; echo "$HP 0 c holder" > "$1/owner"; }`;

d("evotest lock · .exclusive", () => {
  it("ex_held: không có ⇒ 1; owner sống ⇒ 0; owner chết ⇒ gỡ khoá mồ côi, 1", () => {
    const r = tmp();
    const s = `${HOLD}
ex_held; echo none=$?
holder "$EX" 30; ex_held; echo live=$?; kill $HP
sleep 0.1 & D=$!; wait $D; echo "$D 0 c dead" > "$EX/owner"; ex_held; echo dead=$?; [ -d "$EX" ]; echo dir=$?`;
    const { out } = sh(r, s);
    expect(out).toContain("none=1");
    expect(out).toContain("live=0");
    expect(out).toContain("dead=1");
    expect(out).toContain("dir=1"); // đã gỡ
  });

  it("ex_acquire: mọi slot rảnh ⇒ giữ khoá, ghi owner có tag; ex_release chỉ nhả khi đúng tag", () => {
    const r = tmp();
    const { rc, out } = sh(
      r,
      `ex_acquire c1 tagA 5; echo acq=$?; echo owner=$(cat "$EX/owner" | cut -d' ' -f3-)
ex_release other; [ -d "$EX" ]; echo kept=$?; ex_release tagA; [ -d "$EX" ]; echo gone=$?`,
    );
    expect(rc).toBe(0);
    expect(out).toContain("acq=0");
    expect(out).toContain("owner=c1 tagA");
    expect(out).toContain("kept=0");
    expect(out).toContain("gone=1");
  });

  it("ex_acquire: lượt exclusive khác còn sống ⇒ hết hạn exit 3, KHÔNG gỡ khoá của họ", () => {
    const r = tmp();
    const { out } = sh(
      r,
      `${HOLD}
holder "$EX" 30; ex_acquire c2 tagB 1; echo rc=$?; [ -d "$EX" ]; echo theirs=$?; kill $HP`,
    );
    expect(out).toContain("rc=3");
    expect(out).toContain("theirs=0");
  });

  it("ex_acquire: slot còn bận quá hạn ⇒ exit 3, nêu slot, nhả .exclusive của mình", () => {
    const r = tmp();
    const { out } = sh(
      r,
      `${HOLD}
holder "$(lockof 2)" 30; ex_acquire c3 tagC 1; echo rc=$?; [ -d "$EX" ]; echo mine=$?; kill $HP`,
    );
    expect(out).toContain("rc=3");
    expect(out).toContain("slot còn bận: s2");
    expect(out).toContain("mine=1");
  });

  it("ex_acquire: slot bận nhả giữa chừng ⇒ chờ xong rồi giữ khoá (exit 0); owner chết không chặn", () => {
    const r = tmp();
    const { out } = sh(
      r,
      `${HOLD}
holder "$(lockof 3)" 0.3
sleep 0.05 & D=$!; wait $D; mkdir -p "$(lockof 4)"; echo "$D 0 c dead" > "$(lockof 4)/owner"
ex_acquire c4 tagD 10; echo rc=$?`,
    );
    expect(out).toContain("rc=0");
  });
});

d("evotest boot.sh · -Exclusive", () => {
  /** HOME riêng + bộ kit giả (remote.sh) + lock.sh; trả hàm chạy boot. */
  function rig(home: string) {
    const R = join(home, "workspace/evotest");
    mkdirSync(R, { recursive: true });
    const kitSrc = mkdtempSync(join(tmpdir(), "evo-kit-"));
    const log = join(home, "order.log");
    const fifo = join(home, "rel");
    Bun.spawnSync(["mkfifo", fifo]);
    // remote.sh giả: "ex" chặn tới khi test ghi vào fifo; "fail" thoát 5; còn lại chạy ngay.
    writeFileSync(
      join(kitSrc, "remote.sh"),
      `echo "$1" >> "${log}"; [ "$1" = ex ] && read -r _ < "${fifo}"; echo "done-$1" >> "${log}"; [ "$1" = fail ] && exit 5; exit 0\n`,
    );
    const start = (step: string, tag: string, env: Record<string, string>) => {
      const kit = join(tmpdir(), `evotest-kit-${tag}.tgz`);
      Bun.spawnSync(["tar", "czf", kit, "-C", kitSrc, "remote.sh"]);
      const lib = join(home, `lock-${tag}.sh`);
      copyFileSync(LOCK, lib);
      return Bun.spawn(["bash", BOOT, step, "c0ffee", tag], {
        env: {
          ...process.env,
          HOME: home,
          EVO_LOCKLIB: lib,
          EVO_SLOTS: "4",
          EVO_POLL_S: "0.05",
          EVO_PROGRESS_S: "1",
          ...env,
        },
        stdout: "pipe",
        stderr: "pipe",
      });
    };
    return { R, log, fifo, start };
  }

  const readers = new WeakMap<
    object,
    { r: ReadableStreamDefaultReader<Uint8Array>; text: string }
  >();
  const dec = new TextDecoder();
  /** Đọc stdout tới khi gặp `marker` (đợi tín hiệu, không ngủ); marker rỗng = đọc tới hết. Trả toàn bộ chữ đã đọc. */
  async function until(p: ReturnType<typeof Bun.spawn>, marker: string) {
    let s = readers.get(p);
    if (!s) {
      s = { r: (p.stdout as ReadableStream<Uint8Array>).getReader(), text: "" };
      readers.set(p, s);
    }
    while (marker === "" || !s.text.includes(marker)) {
      const { done, value } = await s.r.read();
      if (done) break;
      s.text += dec.decode(value);
    }
    return s.text;
  }
  it("lượt thường xếp hàng khi có exclusive, chỉ chạy SAU khi exclusive xong và nhả khoá; in tải đầu/cuối", async () => {
    const home = tmp();
    const { R, log, fifo, start } = rig(home);
    const ex = start("ex", "tagEx", { EVO_EXCLUSIVE: "1", EVO_EXCLUSIVE_TIMEOUT_S: "30" });
    const exStart = await until(ex, "exclusive-start");
    expect(exStart).toMatch(/load1=\S* nproc=\S* mem_avail_mb=\d+ slot_ban=\[\]/);
    expect(existsSync(join(R, ".exclusive"))).toBe(true);
    const normal = start("normal", "tagN", {});
    expect(await until(normal, "-Exclusive đang giữ máy")).toContain("xếp hàng");
    // nhả remote.sh của exclusive
    Bun.spawnSync(["bash", "-c", `echo go > "${fifo}"`]);
    const [exOut, nOut] = await Promise.all([until(ex, ""), until(normal, "")]);
    expect(await ex.exited).toBe(0);
    expect(await normal.exited).toBe(0);
    expect(exOut).toMatch(/exclusive-end load1=\S* .*exit=0/);
    expect(nOut).toContain("[evotest] slot");
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "ex",
      "done-ex",
      "normal",
      "done-normal",
    ]);
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
  });

  it("exclusive lỗi (remote.sh exit 5) ⇒ mã 5 truyền ra, khoá .exclusive và slot được nhả", async () => {
    const home = tmp();
    const { R, start } = rig(home);
    const p = start("fail", "tagF", { EVO_EXCLUSIVE: "1", EVO_EXCLUSIVE_TIMEOUT_S: "30" });
    expect(await p.exited).toBe(5);
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
    expect(existsSync(join(R, ".lock"))).toBe(false);
  });

  it("exclusive bị SIGTERM khi đang đo ⇒ nhả .exclusive + slot, dừng remote.sh", async () => {
    const home = tmp();
    const { R, start } = rig(home);
    const p = start("ex", "tagT", { EVO_EXCLUSIVE: "1", EVO_EXCLUSIVE_TIMEOUT_S: "30" });
    await until(p, "exclusive-start");
    p.kill("SIGTERM");
    await p.exited;
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
    expect(existsSync(join(R, ".lock"))).toBe(false);
  });

  it("slot bận quá hạn ⇒ exit 3, không để lại .exclusive", async () => {
    const home = tmp();
    const { R, start } = rig(home);
    const hold = Bun.spawn(["sleep", "30"]);
    mkdirSync(join(R, ".lock"), { recursive: true });
    writeFileSync(join(R, ".lock/owner"), `${hold.pid} 0 c holder`);
    const p = start("ex", "tagO", { EVO_EXCLUSIVE: "1", EVO_EXCLUSIVE_TIMEOUT_S: "1" });
    expect(await p.exited).toBe(3);
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
    hold.kill();
  });

  // tool-evotest-cache · lượt TOÀN BỘ (EVO_FULL_RUN=1)
  it("full run: slot khác bận ⇒ exit 5 (từ chối), không để .exclusive; có EVO_FORCE ⇒ chạy", async () => {
    const home = tmp();
    const { R, log, start } = rig(home);
    const hold = Bun.spawn(["sleep", "30"]);
    mkdirSync(join(R, "slots/s2"), { recursive: true });
    mkdirSync(join(R, "slots/s2/.lock"));
    writeFileSync(join(R, "slots/s2/.lock/owner"), `${hold.pid} 0 c holder`);
    const refused = start("full", "tagR", { EVO_FULL_RUN: "1", EVO_FULL_RECHECK_S: "0.05" });
    expect(await refused.exited).toBe(5);
    expect(await until(refused, "")).toContain("từ chối");
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
    expect(existsSync(log)).toBe(false); // remote.sh không chạy
    const forced = start("full", "tagFo", {
      EVO_FULL_RUN: "1",
      EVO_FORCE: "1",
      EVO_FULL_RECHECK_S: "0.05",
    });
    expect(await forced.exited).toBe(0);
    expect(await until(forced, "")).toContain("-Force");
    expect(existsSync(join(R, ".exclusive"))).toBe(false); // nhả khi xong
    hold.kill();
  });

  it("full run giữ máy: lượt thường xếp hàng, chạy SAU khi full xong; full không chờ slot rảnh khi không ai bận", async () => {
    const home = tmp();
    const { R, log, fifo, start } = rig(home);
    const full = start("ex", "tagFull", { EVO_FULL_RUN: "1", EVO_FULL_RECHECK_S: "0.05" });
    expect(await until(full, "TOÀN BỘ giữ máy chủ")).toContain("slot 1/4");
    const own = readFileSync(join(R, ".exclusive/owner"), "utf8").trim().split(" ");
    expect(own[4]).toBe("full");
    const normal = start("normal", "tagN2", {});
    expect(await until(normal, "xếp hàng")).toContain("TOÀN BỘ");
    Bun.spawnSync(["bash", "-c", `echo go > "${fifo}"`]);
    await Promise.all([until(full, ""), until(normal, "")]);
    expect(await full.exited).toBe(0);
    expect(await normal.exited).toBe(0);
    expect(readFileSync(log, "utf8").trim().split("\n")).toEqual([
      "ex",
      "done-ex",
      "normal",
      "done-normal",
    ]);
    expect(existsSync(join(R, ".exclusive"))).toBe(false);
  });
});
