// Kiểm bằng git thật trong repo tạm: merge driver i18njson + rebase tự giải tests/.lock (không cần DB).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { rebaseResolvingLock, relockAfterRebase } from "./slice-rebase";

const DRIVER = resolve(import.meta.dir, "json-merge-driver.ts").replace(/\\/g, "/");
const LOCALE = "packages/i18n/locales/vi.json";
let root: string;
let n = 0;

function git(cwd: string, ...args: string[]) {
  const p = Bun.spawnSync(
    ["git", "-c", "user.name=t", "-c", "user.email=t@t", "-c", "commit.gpgsign=false", ...args],
    { cwd, stdout: "pipe", stderr: "pipe" },
  );
  return { ok: p.exitCode === 0, out: `${p.stdout}${p.stderr}`.trim() };
}
const write = (repo: string, f: string, text: string) => {
  mkdirSync(dirname(join(repo, f)), { recursive: true });
  writeFileSync(join(repo, f), text);
};
const read = (repo: string, f: string) =>
  readFileSync(join(repo, f), "utf8").replace(/\r\n/g, "\n");
const commit = (repo: string, msg: string) => {
  git(repo, "add", "-A");
  expect(git(repo, "commit", "-m", msg).ok).toBe(true);
};

function newRepo(files: Record<string, string>): string {
  const repo = join(root, `r${n++}`);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "config", "core.autocrlf", "false");
  git(repo, "config", "merge.i18njson.driver", `bun "${DRIVER}" %O %A %B %P`);
  write(
    repo,
    ".gitattributes",
    "* text=auto eol=lf\npackages/i18n/locales/**/*.json merge=i18njson\n",
  );
  for (const [f, t] of Object.entries(files)) write(repo, f, t);
  commit(repo, "base");
  return repo;
}
const json = (o: object) => `${JSON.stringify(o, null, 2)}\n`;

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), "merge-driver-"));
});
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("merge driver i18njson (git thật)", () => {
  test("hai nhánh thêm key khác nhau cuối cùng một khối ⇒ merge sạch, giữ định dạng", () => {
    const base = { common: { ok: "OK" }, login: { title: "T" } };
    const repo = newRepo({ [LOCALE]: json(base) });
    git(repo, "checkout", "-q", "-b", "a");
    write(repo, LOCALE, json({ ...base, login: { title: "T", a: "A" } }));
    commit(repo, "a");
    git(repo, "checkout", "-q", "main");
    git(repo, "checkout", "-q", "-b", "b");
    write(repo, LOCALE, json({ ...base, login: { title: "T", b: "B" } }));
    commit(repo, "b");
    const m = git(repo, "merge", "--no-edit", "a");
    expect(m.ok).toBe(true);
    // đang ở nhánh b (ours) ⇒ key của b trước, key của a chèn sau
    expect(read(repo, LOCALE)).toBe(
      json({ common: { ok: "OK" }, login: { title: "T", b: "B", a: "A" } }),
    );
  });

  test("rebase hai nhánh cùng thêm key vào file locale ⇒ không conflict", () => {
    const repo = newRepo({ [LOCALE]: json({ k: "v" }) });
    git(repo, "checkout", "-q", "-b", "slice");
    write(repo, LOCALE, json({ k: "v", s: "S" }));
    commit(repo, "slice");
    git(repo, "checkout", "-q", "main");
    write(repo, LOCALE, json({ k: "v", m: "M" }));
    commit(repo, "main");
    git(repo, "checkout", "-q", "slice");
    expect(git(repo, "rebase", "main").ok).toBe(true);
    expect(JSON.parse(read(repo, LOCALE))).toEqual({ k: "v", m: "M", s: "S" });
  });

  test("cùng key đổi khác nhau ⇒ conflict thật: merge fail, file có dấu conflict + thông báo", () => {
    const repo = newRepo({ [LOCALE]: json({ k: "v" }) });
    git(repo, "checkout", "-q", "-b", "a");
    write(repo, LOCALE, json({ k: "A" }));
    commit(repo, "a");
    git(repo, "checkout", "-q", "main");
    write(repo, LOCALE, json({ k: "B" }));
    commit(repo, "main");
    const m = git(repo, "merge", "--no-edit", "a");
    expect(m.ok).toBe(false);
    expect(m.out).toContain("i18njson: conflict thật");
    expect(m.out).toContain("key xung đột: k");
    expect(read(repo, LOCALE)).toContain("<<<<<<<");
  });
});

describe("rebase tự giải tests/.lock", () => {
  test("conflict chỉ ở tests/.lock ⇒ rebase xong, relock sinh lại và commit", () => {
    const repo = newRepo({ "tests/.lock": "# hdr\nh1  a.ts\n" });
    git(repo, "checkout", "-q", "-b", "slice");
    write(repo, "tests/.lock", "# hdr\nh1  a.ts\nh2  slice.ts\n");
    write(repo, "e2e/slice.ts", "x\n");
    commit(repo, "slice 1");
    write(repo, "tests/.lock", "# hdr\nh1  a.ts\nh2  slice.ts\nh3  slice2.ts\n");
    write(repo, "e2e/slice2.ts", "y\n");
    commit(repo, "slice 2");
    git(repo, "checkout", "-q", "main");
    write(repo, "tests/.lock", "# hdr\nh1  a.ts\nh9  main.ts\n");
    write(repo, "e2e/main.ts", "m\n");
    commit(repo, "main");
    git(repo, "checkout", "-q", "slice");

    const g = (...a: string[]) => git(repo, ...a);
    const rb = rebaseResolvingLock(g, "main");
    expect(rb.ok).toBe(true);
    expect(rb.lockResolved).toBeGreaterThan(0);
    const rl = relockAfterRebase(g, () => {
      write(repo, "tests/.lock", "# hdr\nh1  a.ts\nh2  slice.ts\nh3  slice2.ts\nh9  main.ts\n");
      return true;
    });
    expect(rl).toEqual({ committed: true });
    expect(g("status", "--porcelain").out).toBe("");
    expect(read(repo, "tests/.lock")).toContain("h9  main.ts");
    expect(read(repo, "e2e/slice2.ts")).toBe("y\n");
  });

  test("conflict ở file khác ngoài tests/.lock ⇒ dừng, báo lỗi (không tự giải)", () => {
    const repo = newRepo({ "src.ts": "a\n", "tests/.lock": "h\n" });
    git(repo, "checkout", "-q", "-b", "slice");
    write(repo, "src.ts", "slice\n");
    commit(repo, "slice");
    git(repo, "checkout", "-q", "main");
    write(repo, "src.ts", "main\n");
    commit(repo, "main");
    git(repo, "checkout", "-q", "slice");
    const rb = rebaseResolvingLock((...a) => git(repo, ...a), "main");
    expect(rb.ok).toBe(false);
    expect(rb.lockResolved).toBe(0);
    git(repo, "rebase", "--abort");
  });
});
