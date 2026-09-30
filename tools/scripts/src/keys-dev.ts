// ADM-NFR-06 · `bun run keys:dev`: sinh .env.local với khoá dev (spec M0 T-KEYS-1). Không in giá trị.
import { generateKeyPairSync, randomBytes, randomInt } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "./lib/git";

export type DevSecrets = {
  JWT_PRIVATE_KEY: string;
  JWT_PUBLIC_KEY: string;
  JWT_KID: string;
  SECRET_MASTER_KEY: string;
  SEED_ADMIN_PASSWORD: string;
};

const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

function kidFor(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `dev-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
}

/** PEM viết thành chuỗi `"…"` một dòng, xuống dòng là `\n` (Bun dotenv tự mở). */
export function quotePem(pem: string): string {
  return `"${pem.trimEnd().replace(/\r?\n/g, "\\n")}"`;
}

export function generateDevSecrets(now: Date = new Date()): DevSecrets {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519", {
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
    publicKeyEncoding: { type: "spki", format: "pem" },
  });
  return {
    JWT_PRIVATE_KEY: privateKey,
    JWT_PUBLIC_KEY: publicKey,
    JWT_KID: kidFor(now),
    SECRET_MASTER_KEY: randomBytes(32).toString("base64"),
    SEED_ADMIN_PASSWORD: Array.from({ length: 20 }, () => ALNUM[randomInt(ALNUM.length)]).join(""),
  };
}

const lineRe = (key: string) => new RegExp(`^\\s*${key}\\s*=(.*)$`);

function unquote(raw: string): string {
  const v = raw.trim();
  const q = v[0];
  return (q === '"' || q === "'") && v.endsWith(q) && v.length >= 2 ? v.slice(1, -1) : v;
}

/** Giá trị (đã bỏ nháy) của `key` trong nội dung .env; không có dòng → undefined. */
export function readEnvValue(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const m = lineRe(key).exec(line);
    if (m) return unquote(m[1] ?? "");
  }
  return undefined;
}

/** Điền key rỗng (hoặc mọi key khi `force`); key vắng thêm cuối file. Giữ comment, thứ tự, kiểu xuống dòng. */
export function mergeEnv(text: string, values: Record<string, string>, force: boolean): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const lines = text.length ? text.split(/\r?\n/) : [];
  const endsWithEol = lines.length > 0 && lines[lines.length - 1] === "";
  if (endsWithEol) lines.pop();
  for (const [key, value] of Object.entries(values)) {
    const at = lines.findIndex((l) => lineRe(key).test(l));
    if (at === -1) {
      lines.push(`${key}=${value}`);
      continue;
    }
    const current = readEnvValue(lines[at] ?? "", key) ?? "";
    if (force || current === "") lines[at] = `${key}=${value}`;
  }
  return lines.join(eol) + (lines.length ? eol : "");
}

export function isProduction(
  procEnv: Record<string, string | undefined>,
  envLocalText?: string,
): boolean {
  if (procEnv.APP_ENV === "production") return true;
  return envLocalText !== undefined && readEnvValue(envLocalText, "APP_ENV") === "production";
}

function main(argv: string[]): number {
  const root = repoRoot();
  const localPath = join(root, ".env.local");
  const examplePath = join(root, ".env.example");
  const existing = existsSync(localPath) ? readFileSync(localPath, "utf8") : undefined;
  if (isProduction(process.env, existing)) {
    console.error("keys:dev: không chạy khi APP_ENV=production");
    return 1;
  }
  if (existing === undefined && !existsSync(examplePath)) {
    console.error("keys:dev: không tìm thấy .env.example");
    return 1;
  }
  const base = existing ?? readFileSync(examplePath, "utf8");
  const s = generateDevSecrets();
  const values = {
    ...s,
    JWT_PRIVATE_KEY: quotePem(s.JWT_PRIVATE_KEY),
    JWT_PUBLIC_KEY: quotePem(s.JWT_PUBLIC_KEY),
  };
  const next = mergeEnv(base, values, argv.includes("--force"));
  const changed = Object.keys(values).filter(
    (k) => readEnvValue(next, k) !== readEnvValue(base, k),
  );
  if (next !== existing) writeFileSync(localPath, next);
  console.log(
    changed.length
      ? `keys:dev: đã điền ${changed.join(", ")} vào .env.local`
      : "keys:dev: .env.local đã đủ khoá, không đổi",
  );
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
