// com-prod-seed · cred cho e2e community-web chạy trên PRODUCTION (playwright.deployed.config.ts). KHÔNG in/ghi mật khẩu ra log.
//   CS_CRED_FILE        file cred đối tác (= file --out của seed: { users: { <username>: <mật khẩu> } }), file LOCAL, bắt buộc.
//   CS_NEW_PW           mật khẩu mới cho lần đổi bắt buộc của đối tác (bắt buộc; sau đó ghi ngược vào CS_CRED_FILE).
//   CS_OWNER_PW         mật khẩu demo-owner; hoặc CS_OWNER_CRED_FILE = file dòng "demo-owner / <mật khẩu>" (DEMO_CREDENTIALS.txt).
import { readFileSync } from "node:fs";

export const PROD_COMMUNITY_URL = "https://community.evoluconsulting.com";

/** Mật khẩu của `user` trong file dạng "user / pw [ghi chú]" (một dòng mỗi tài khoản). null nếu không có. */
export function pwFromCredText(text: string, user: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    const m = line.trim().split(/\s+\/\s+/);
    if (m[0] === user && m[1]) return (m[1].split(/\s+/)[0] as string).trim() || null;
  }
  return null;
}

/** Nạp env cho `_stack.ts` (workers thừa kế env của tiến trình cấu hình). Ném lỗi (không kèm giá trị) nếu thiếu. */
export function loadDeployedEnv(env: NodeJS.ProcessEnv = process.env): void {
  const file = env.CS_CRED_FILE;
  if (!file) throw new Error("cần CS_CRED_FILE (file cred đối tác = --out của seed)");
  if (!env.CS_NEW_PW) throw new Error("cần CS_NEW_PW (mật khẩu mới cho lần đổi bắt buộc)");
  let owner = env.CS_OWNER_PW;
  if (!owner && env.CS_OWNER_CRED_FILE)
    owner = pwFromCredText(readFileSync(env.CS_OWNER_CRED_FILE, "utf8"), "demo-owner") ?? undefined;
  if (!owner)
    throw new Error("cần CS_OWNER_PW hoặc CS_OWNER_CRED_FILE (dòng 'demo-owner / <mật khẩu>')");
  env.DEMO_OWNER_PW = owner;
  env.COMMUNITY_SEED_PW_FILE = file;
  env.CS_CRED_WRITEBACK = file;
  env.CS_READONLY = "1";
  env.COMMUNITY_URL = env.COMMUNITY_URL ?? PROD_COMMUNITY_URL;
}
