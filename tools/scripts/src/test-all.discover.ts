// #225 · tìm cấu hình Playwright cho `test:all`. Tách riêng để test được (test-all.ts chạy ngay khi nạp).
import { Glob } from "bun";

export async function findE2eConfigs(root: string): Promise<string[]> {
  const out: string[] = [];
  // Hai quét riêng: Glob.scan của Bun trả 0 kết quả với mẫu `{a,b/**/c}` trên Windows.
  // `*.deployed.config.ts` chạy với production thật (cần cred + mạng) ⇒ không thuộc test:all.
  // `e2e/smoke-journey/` là công cụ kiểm môi trường thật (deploy/smoke, tạo công ty tạm qua SSH) ⇒ không thuộc bộ e2e evotest.
  // `e2e/prod-journey/` chỉ chạy qua deploy/smoke/prod-journey.ps1 (cần PJ_CW/PJ_PW + môi trường đã deploy) ⇒ cũng loại.
  for (const pattern of ["playwright.config.ts", "e2e/**/playwright*.config.ts"])
    for await (const f of new Glob(pattern).scan(root))
      if (
        !/\.deployed\.config\.ts$/.test(f) &&
        !f.replaceAll("\\", "/").startsWith("e2e/smoke-journey/") &&
        !f.replaceAll("\\", "/").startsWith("e2e/prod-journey/")
      )
        out.push(f);
  return out;
}
