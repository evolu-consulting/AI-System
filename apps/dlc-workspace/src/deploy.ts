// dlc-dify · deploy app của project (người quyết định qua dlc-agent): chọn commit trên `main` (HEAD, hoặc commit merge mới
// nhất trong các việc `ready_to_deploy` được chọn), xuất bản sạch ra `<dir>/<key>/releases/<sha>`, build trong container dùng
// một lần, rồi thay container chạy `dlc-app-<key>` (dữ liệu app ở `<dir>/<key>/data`, env bí mật ở `<dir>/<key>/deploy.env`).
// Việc nằm trong commit đã deploy ⇒ `deployed`. Không đẩy code đi đâu: chỉ chạy trên máy chủ của workspace.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { runInContainer } from "./exec";
import { git, repoDir, withLock } from "./git";

export type DeployCfg = {
  /** Lệnh build chạy ở gốc bản release (ảnh exec của workspace, vd node:22-bookworm). */
  build_command: string;
  /** Ảnh và lệnh chạy app; bản release mount ở `/app`, dữ liệu ở `/data`. */
  image: string;
  run_command: string;
  port: number;
  container_port: number;
  /** Địa chỉ người dùng mở app (chỉ để báo lại). */
  url: string;
};

export type DeployRecord = {
  sha: string;
  at: string;
  ok: boolean;
  tasks: string[];
  url: string;
  note: string;
};

const OUT_TAIL = 4000;
const SHA_RE = /^[0-9a-f]{7,40}$/;

async function sh(cmd: string[]): Promise<{ code: number; out: string }> {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  return { code: await p.exited, out: `${out}${err}`.trim() };
}

/** `a` nằm trong lịch sử của `b`. */
export async function isAncestor(repo: string, a: string, b: string): Promise<boolean> {
  return (await git(repo, ["merge-base", "--is-ancestor", a, b])).code === 0;
}

/** Bản sạch của commit (git archive) — đã có ⇒ dùng lại. */
async function exportRelease(root: string, key: string, sha: string): Promise<string> {
  const dir = join(root, key, "releases", sha.slice(0, 12));
  if (existsSync(join(dir, ".release-ok"))) return dir;
  mkdirSync(dir, { recursive: true });
  const r = await sh([
    "sh",
    "-c",
    `git -C "${repoDir(root, key)}" archive "${sha}" | tar -x -C "${dir}" && touch "${dir}/.release-ok"`,
  ]);
  if (r.code !== 0) throw new Error(`export ${sha}: ${r.out.slice(0, 500)}`);
  return dir;
}

/** Thay container `dlc-app-<key>` bằng bản release mới; trả trạng thái chạy + log cuối. */
async function swapContainer(o: {
  root: string;
  key: string;
  cfg: DeployCfg;
  dir: string;
  sha: string;
}) {
  const { root, key, cfg, dir, sha } = o;
  const name = `dlc-app-${key}`;
  const data = join(root, key, "data");
  mkdirSync(data, { recursive: true });
  const envFile = join(root, key, "deploy.env");
  await sh(["docker", "rm", "-f", name]);
  const run = await sh([
    "docker",
    "run",
    "-d",
    "--name",
    name,
    "--restart",
    "unless-stopped",
    "--cpus",
    "1",
    "--memory",
    "512m",
    "-p",
    `${cfg.port}:${cfg.container_port}`,
    "-v",
    `${dir}:/app`,
    "-v",
    `${data}:/data`,
    "-w",
    "/app",
    ...(existsSync(envFile) ? ["--env-file", envFile] : []),
    "-e",
    `APP_VERSION=${sha.slice(0, 12)}`,
    cfg.image,
    "sh",
    "-c",
    cfg.run_command,
  ]); // prettier-ignore
  if (run.code !== 0) return { ok: false, log: run.out };
  await Bun.sleep(5000);
  const st = await sh(["docker", "inspect", "-f", "{{.State.Running}}", name]);
  const log = await sh(["docker", "logs", "--tail", "30", name]);
  return { ok: st.out.trim() === "true", log: log.out };
}

/** Build + chạy commit `sha` của project `key` (một deploy mỗi project tại một thời điểm). */
export function deployCommit(o: {
  root: string;
  key: string;
  cfg: DeployCfg;
  sha: string;
  builder: string;
  timeoutS: number;
}): Promise<{ ok: boolean; output: string }> {
  if (!SHA_RE.test(o.sha)) throw new Error("bad sha");
  return withLock(`deploy:${o.key}`, async () => {
    const dir = await exportRelease(o.root, o.key, o.sha);
    const b = await runInContainer({
      dir,
      command: o.cfg.build_command,
      timeoutS: o.timeoutS,
      image: o.builder,
    });
    const built = `$ ${o.cfg.build_command}\nexit=${b.exit_code}\n${b.output.slice(-OUT_TAIL)}`;
    if (b.exit_code !== 0 || b.timed_out) return { ok: false, output: `BUILD FAILED\n${built}` };
    const s = await swapContainer({ ...o, dir });
    const output = `${built}\n\n$ run ${o.cfg.image}: ${s.ok ? "running" : "NOT RUNNING"}\n${s.log.slice(-OUT_TAIL)}`;
    return { ok: s.ok, output };
  });
}
