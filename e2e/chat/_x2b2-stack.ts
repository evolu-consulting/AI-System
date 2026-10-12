// HUB-FR-44 · HUB-FR-101 · e2e X2b-2 (test-plan X2b2 §5): stack X2b (`_x2b-stack.ts`: DB test + hub:seed + agent hoadon/trello +
// admin-api + hub-api + Runtime giả `/rt/<op>`) BẬT kho đính kèm: `HUB_ATTACH_DRIVER=local`, `HUB_ATTACH_DIR` = thư mục tạm riêng
// (hub-api con thừa hưởng env). Sau khi stack X2b sẵn sàng: `hoadon` bật `Write` (agent ghi `out/`, như H2c PL9) + tăng
// `hub_config_version` (Hub poll 2 s), rồi mới mở cổng sẵn sàng X2b-2 (`X2B2_READY_PORT`) — Playwright chờ cổng này.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import postgres from "postgres";

const dir = mkdtempSync(join(tmpdir(), "e2e-x2b2-attach-"));
process.env.HUB_ATTACH_DRIVER = "local";
process.env.HUB_ATTACH_DIR = dir;
process.once("exit", () => rmSync(dir, { recursive: true, force: true }));

await import("./_x2b-stack");

const url = process.env.TEST_DATABASE_URL ?? "";
const sql = postgres(url, { max: 1, onnotice: () => {} });
try {
  await sql`update hub.agents set runtime_options = ${sql.json({ allowed_tools: ["Read", "Grep", "Write"] })}
    where key in ('hoadon', 'trello')`;
  await sql`update hub.config_meta set hub_config_version = hub_config_version + 1 where id = 1`;
} finally {
  await sql.end();
}
// biome-ignore lint/suspicious/noUndeclaredEnvVars: biến e2e (playwright.x2b2.config đặt)
const ready = Number(process.env.X2B2_READY_PORT ?? 4069);
Bun.serve({ port: ready, fetch: () => new Response("ok") });
console.log(`[x2b2] sẵn sàng: kho ${dir} · cổng ${ready}`);
