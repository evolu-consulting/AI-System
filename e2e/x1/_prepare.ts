// X1 e2e · chạy `e2e/support/prepare-db.ts` (reset + migrate + seed + fixture M1–M3) có thử lại.
// Bẫy đã gặp (QC1b P3): `prepare-db` bản đầy đủ chạy LIỀN SAU một lần đầy đủ khác thỉnh thoảng lỗi ở
// `ALTER ROLE admin_api …` (Failed query) rồi lần kế lại xanh ⇒ thử lại tối đa 3 lần. Không sửa `e2e/support/*`.
import { resolve } from "node:path";

const REPO = resolve(import.meta.dir, "../..");

export function prepareDbWithRetry(maxTries = 3): void {
  for (let i = 1; i <= maxTries; i++) {
    const p = Bun.spawnSync([process.execPath, "e2e/support/prepare-db.ts"], {
      cwd: REPO,
      env: process.env,
      stdout: "inherit",
      stderr: "inherit",
    });
    if (p.exitCode === 0) return;
    console.warn(`[x1] prepare-db lỗi lần ${i}/${maxTries}`);
  }
  throw new Error("prepare-db lỗi sau nhiều lần thử");
}

if (import.meta.main) prepareDbWithRetry();
