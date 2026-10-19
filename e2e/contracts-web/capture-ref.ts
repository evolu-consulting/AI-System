// PK-FR-10 · TF7 · chụp lại baseline từ web mgmt-app thật (plan-frontend §6.2): `bun run e2e:contracts:ref`.
// Dựng Vite ở $MGMT_WEB_DIR (mặc định F:\workspace\mgmt-app\web) cổng 5199, API giả `page.route` (không cần backend mgmt),
// ghi `baseline/<platform>/*.png|json`. Chụp 1 lần/lát khi màn mgmt-app không đổi; nhớ commit ảnh.
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const proc = Bun.spawn(
  [
    "bunx",
    "playwright",
    "test",
    "-c",
    "e2e/contracts-web/playwright.config.ts",
    ...process.argv.slice(2),
  ],
  { cwd: root, env: { ...process.env, CW_MODE: "ref" }, stdout: "inherit", stderr: "inherit" },
);
process.exit(await proc.exited);
