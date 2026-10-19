// R1 · ADR-0021 §3: nguồn ngoài KnowledgeHub cho `knowledge-search`. Dùng lại `KhClient` của module `kh` (đóng băng — chỉ import,
// không sửa): chính sách URL, `redirect:"error"`, hạn gọi, đọc thân ≤ 1 MiB, khoá trong header `X-KH-Key` không log. Cấu hình
// (env, vắng ⇒ TẮT, không gọi mạng): `KNOWLEDGE_KH_URL`, `KNOWLEDGE_KH_KEY` (secret — chỉ đọc lúc gọi), `KNOWLEDGE_KH_PROJECT`,
// `KNOWLEDGE_KH_TENANTS` (uuid cách dấu phẩy, hoặc `*`; vắng ⇒ không tenant nào — KH là kho dùng chung),
// `KNOWLEDGE_KH_TIMEOUT_MS` (1000–30000, mặc định 3000).
import { KhClient, type KhConn } from "../../kh/kh.client";
import type { ExternalSource, Hit } from "../application/ports";
import { parseKhHits } from "../domain/federation.rules";

export type KhSourceConfig = {
  url: string;
  key: string;
  project: string;
  tenants: "*" | ReadonlySet<string>;
  timeoutMs: number;
};

const num = (v: string | undefined, def: number, lo: number, hi: number): number => {
  const n = Number(v);
  return Number.isInteger(n) && n >= lo && n <= hi ? n : def;
};

/** Đủ URL + key + project ⇒ cấu hình; thiếu một ⇒ null (tắt). URL sai dạng ⇒ null. */
export function khSourceConfig(env: Record<string, string | undefined>): KhSourceConfig | null {
  const { KNOWLEDGE_KH_URL: url, KNOWLEDGE_KH_KEY: key, KNOWLEDGE_KH_PROJECT: project } = env;
  if (!url || !key || !project || !URL.canParse(url)) return null;
  const raw = (env.KNOWLEDGE_KH_TENANTS ?? "").trim();
  const tenants =
    raw === "*"
      ? "*"
      : new Set(
          raw
            .split(",")
            .map((t) => t.trim().toLowerCase())
            .filter(Boolean),
        );
  return {
    url,
    key,
    project,
    tenants,
    timeoutMs: num(env.KNOWLEDGE_KH_TIMEOUT_MS, 3000, 1000, 30_000),
  };
}

export function khSource(
  cfg: KhSourceConfig,
  o: { dev: boolean; fetch?: typeof fetch },
): ExternalSource {
  const origin = new URL(cfg.url).origin;
  const client = new KhClient({
    // khoá từ env/secret của module tri thức: đưa thẳng vào lời gọi, không giữ ở nơi khác
    secrets: { useSecret: (_ref, fn) => fn(cfg.key) },
    cfg: { allowedOrigins: [origin], timeoutMs: cfg.timeoutMs },
    dev: o.dev,
    ...(o.fetch ? { fetch: o.fetch } : {}),
  });
  const conn: KhConn = { id: "knowledge-kh", baseUrl: cfg.url, secretId: "env", version: 1 };
  return {
    name: "kh",
    allows: (t) => cfg.tenants === "*" || cfg.tenants.has(t.toLowerCase()),
    async search(query, k, signal): Promise<Hit[]> {
      const body = await client.query(conn, { text: query, project: cfg.project }, signal);
      return parseKhHits(body, k, "kh");
    },
  };
}
