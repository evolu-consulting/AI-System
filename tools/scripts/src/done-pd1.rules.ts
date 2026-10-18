// P-d1 · HUB-FR-143 · luật thuần của `bun run done:pd1` (T12): danh sách bước, tìm Node cho Playwright, tổng kết.
// `done-pd1.ts` lo chạy lệnh. Khác done:pc2: KHÔNG dừng ở bước đỏ đầu — chạy hết rồi in tổng kết.

export type PdStep = {
  title: string;
  argv: string[];
  /** Thư mục Node cần đặt đầu PATH (chỉ bước e2e), nếu có. */
  nodeDir?: string;
  /** "depcruise": xanh khi 0 vi phạm `ca-*` (bỏ qua vi phạm cũ ngoài ca-*). */
  kind?: "depcruise";
};
export type PdResult = { title: string; code: number; ms: number };

export const DEFAULT_NODE_DIR = "F:\\workspace\\tools\\node-22\\node-v22.23.3-win-x64";

/** `node` tìm được có phải Node thật không: shim của bun (`bun-node-*`, hoặc trỏ tới bun.exe) không tính. */
export function isRealNode(nodePath: string | null | undefined, resolvedExe?: string): boolean {
  if (!nodePath) return false;
  if (/bun-node/i.test(nodePath)) return false;
  return !/(^|[\\/])bun(\.exe)?$/i.test(resolvedExe ?? "");
}

/** Đếm vi phạm depcruise (`--output-type err`): tổng và riêng luật `ca-*`. */
export function parseDepcruise(out: string): { total: number; ca: number } {
  let total = 0;
  let ca = 0;
  for (const m of out.matchAll(/^\s*(?:error|warn|info)\s+([\w.-]+):/gm)) {
    total++;
    if (m[1]?.startsWith("ca-")) ca++;
  }
  return { total, ca };
}

/** Thư mục Node đặt đầu PATH cho e2e: null khi `node` đã có trên PATH hoặc thư mục không tồn tại. */
export function resolveNodeDir(o: {
  override?: string;
  nodeOnPath: boolean;
  exists: (dir: string) => boolean;
}): string | null {
  const dir = o.override || DEFAULT_NODE_DIR;
  if (o.nodeOnPath && !o.override) return null;
  return o.exists(dir) ? dir : null;
}

/** Trả `PATH` mới với `dir` đặt đầu (phân tách theo nền tảng). */
export const prependPath = (dir: string, current: string | undefined, sep: string): string =>
  current ? `${dir}${sep}${current}` : dir;

/** Thứ tự = T12. `bun` = đường dẫn chạy bun; Windows bỏ `@ai/agent-runtime` khỏi typecheck. */
export function pd1Steps(o: { bun: string; platform: string; nodeDir: string | null }): PdStep[] {
  const { bun } = o;
  const tc = ["x", "turbo", "typecheck"];
  const typecheck =
    o.platform === "win32"
      ? [bun, ...tc, "--filter=!@ai/agent-runtime"]
      : [bun, "run", "typecheck"];
  return [
    { title: "typecheck", argv: typecheck },
    {
      title: "depcruise --all (0 vi phạm ca-*)",
      argv: [bun, "run", "depcruise", "--all"],
      kind: "depcruise",
    },
    {
      title: "bun test (hub-api, admin-web, chat-web, contracts, P-d/rules)",
      argv: [
        bun,
        "test",
        "apps/hub-api",
        "apps/admin-web",
        "apps/chat-web",
        "packages/contracts",
        "tests/acceptance/P-d/rules",
      ],
    },
    {
      title: "int P-d + hồi quy P-a P-b P-b2 P-c P-c2",
      argv: [
        bun,
        "run",
        "test:int:par",
        ...["P-d", "P-a", "P-b", "P-b2", "P-c", "P-c2"].map((d) => `tests/acceptance/${d}`),
      ],
    },
    { title: "bun run test:perf:pd", argv: [bun, "run", "test:perf:pd"] },
    {
      title: "playwright P-d",
      // Có nodeDir ⇒ gọi thẳng node.exe + CLI Playwright: `bun x` dưới `bun run` vẫn chọn shim `node` giả của Bun
      // (nạp config .ts lỗi) dù PATH đã thêm nodeDir.
      argv: o.nodeDir
        ? [
            `${o.nodeDir}${o.platform === "win32" ? "\\node.exe" : "/node"}`,
            "node_modules/@playwright/test/cli.js",
            "test",
            "-c",
            "e2e/P-d/playwright.pd.config.ts",
          ]
        : [bun, "x", "playwright", "test", "-c", "e2e/P-d/playwright.pd.config.ts"],
      ...(o.nodeDir ? { nodeDir: o.nodeDir } : {}),
    },
    { title: "bun run test:lock:verify", argv: [bun, "run", "test:lock:verify"] },
  ];
}

const fmt = (ms: number): string =>
  ms < 60_000 ? `${(ms / 1000).toFixed(1)}s` : `${(ms / 60_000).toFixed(1)}m`;

/** Bảng tổng kết + dòng kết luận; xanh khi mọi bước mã 0. */
export function summarize(
  rs: readonly PdResult[],
  name = "done:pd1",
): { text: string; ok: boolean } {
  const ok = rs.length > 0 && rs.every((r) => r.code === 0);
  const rows = rs.map(
    (r, i) => `${i + 1}. ${r.code === 0 ? "xanh" : `đỏ (mã ${r.code})`}  ${fmt(r.ms)}  ${r.title}`,
  );
  const red = rs.filter((r) => r.code !== 0).length;
  const verdict = ok ? `${name} XANH` : `${name} ĐỎ (${red}/${rs.length} bước đỏ)`;
  return { text: [...rows, verdict].join("\n"), ok };
}
