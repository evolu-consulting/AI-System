// I1 · hằng + hàm dựng của nguồn mgmt-app GIẢ (không dữ liệu khách thật) dùng chung cho fixture.ts / fixture-parts.ts.
import type { SourceDoc } from "../../../../apps/admin-api/src/modules/mgmt-import/domain/context";
export const SOURCE = "mgmt-i1test";
export const ORG_A = "0a000000-aaaa-4aaa-8aaa-000000000001";
export const ORG_B = "0b000000-bbbb-4bbb-8bbb-000000000002";
/** Hash kiểu mgmt-app `scrypt$<salt 32 hex>$<dk 128 hex>` (N5b nhập được). */
export const SCRYPT = `scrypt$${"ab".repeat(16)}$${"cd".repeat(64)}`;
export const SHA1 = "a".repeat(64);
export const SHA2 = "b".repeat(64);

export const doc = (id: string, src: Record<string, unknown>): SourceDoc => ({
  id,
  src: { id, ...src },
});
export const f = (value: unknown, quote = "") => ({ value, quote, verified: true, edited: false });
export const fields = (o: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(o).map(([k, v]) => [k, f(v, `«${String(v)}»`)]));

export const A = (x: Record<string, unknown>) => ({ org_id: ORG_A, ...x });
