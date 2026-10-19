// #225 · tìm cấu hình Playwright cho `test:all`. Tách riêng để test được (test-all.ts chạy ngay khi nạp).
import { Glob } from "bun";

export async function findE2eConfigs(root: string): Promise<string[]> {
  const out: string[] = [];
  // Hai quét riêng: Glob.scan của Bun trả 0 kết quả với mẫu `{a,b/**/c}` trên Windows.
  for (const pattern of ["playwright.config.ts", "e2e/**/playwright*.config.ts"])
    for await (const f of new Glob(pattern).scan(root)) out.push(f);
  return out;
}
