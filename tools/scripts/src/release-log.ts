// `bun run release:log --env <staging|prod> --ref <sha> [--by <tên>]` — thêm MỘT dòng vào docs/RELEASES.md
// (ngày · môi trường · commit · số migration cuối · CR trong tiêu đề commit từ dòng trước của cùng môi trường). Chỉ đọc git.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";
import {
  appendRow,
  extractCrIds,
  formatRow,
  lastMigrations,
  lastShaForEnv,
} from "./release-log.rules";
import { git, opt } from "./verify-lib";

function main(): number {
  const argv = process.argv.slice(2);
  const env = opt(argv, "env");
  const ref = opt(argv, "ref");
  if ((env !== "staging" && env !== "prod") || !ref) {
    console.log("release:log: cần --env <staging|prod> --ref <sha> [--by <tên>]");
    return 2;
  }
  const root = repoRoot();
  const sha = git(root, ["rev-parse", "--short=9", ref]);
  if (!sha.ok) {
    console.log(`release:log: ref không có: ${ref}`);
    return 2;
  }
  const short = sha.out.trim();
  const file = join(root, "docs/RELEASES.md");
  const md = existsSync(file) ? readFileSync(file, "utf8") : "";
  const prev = lastShaForEnv(md, env);
  const tree = git(root, ["ls-tree", "-r", "--name-only", short, "--", "packages/db"]).out.split(
    /\r?\n/,
  );
  const range =
    prev && git(root, ["cat-file", "-e", `${prev}^{commit}`]).ok ? `${prev}..${short}` : short;
  const limit = prev ? [] : ["--max-count=30"]; // dòng đầu của môi trường: chỉ 30 commit gần nhất
  const subjects = git(root, ["log", ...limit, "--format=%s", range]).out.split(/\r?\n/);
  const date = git(root, ["log", "-1", "--format=%cs", short]).out.trim();
  const row = formatRow({
    date: opt(argv, "date") ?? new Date().toISOString().slice(0, 10),
    env,
    sha: short,
    migrations: lastMigrations(tree),
    crs: extractCrIds(subjects),
    by: opt(argv, "by") ?? "-",
  });
  writeFileSync(file, appendRow(md, row), "utf8");
  console.log(`release:log: ${row} (commit ${date})`);
  return 0;
}

process.exit(main());
