// dlc-dify · chạy lệnh của agent (cài thư viện, chạy test) TRONG container Docker dùng một lần: worktree mount ở `/app`,
// ảnh mặc định `node:22-bookworm` (có cả python3), giới hạn CPU/RAM, hết hạn ⇒ kill. Đầu ra cắt bớt. Không chạy trên máy chủ.
const OUT_MAX = 30_000;

export type ExecResult = { exit_code: number; timed_out: boolean; output: string; ms: number };

export async function runInContainer(o: {
  dir: string;
  command: string;
  timeoutS: number;
  image: string;
}): Promise<ExecResult> {
  const t0 = Date.now();
  const mount = o.dir.replace(/\\/g, "/");
  const name = `dlc-exec-${crypto.randomUUID().slice(0, 8)}`;
  const p = Bun.spawn(
    [
      "docker",
      "run",
      "--rm",
      "--name",
      name,
      "--cpus",
      "2",
      "--memory",
      "2g",
      "-v",
      `${mount}:/app`,
      "-v",
      "dlc-ws-npm-cache:/root/.npm",
      "-w",
      "/app",
      "-e",
      "CI=1",
      o.image,
      "bash",
      "-lc",
      o.command,
    ],
    { stdout: "pipe", stderr: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } },
  );
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    Bun.spawn(["docker", "kill", name]);
  }, o.timeoutS * 1000);
  const [out, err] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  clearTimeout(timer);
  const all = `${out}${err ? `\n[stderr]\n${err}` : ""}`;
  const output = all.length > OUT_MAX ? `…(cắt đầu)\n${all.slice(-OUT_MAX)}` : all;
  return { exit_code: code, timed_out: timedOut, output, ms: Date.now() - t0 };
}
