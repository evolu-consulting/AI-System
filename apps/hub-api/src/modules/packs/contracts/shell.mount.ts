// CR-118 · cổng gói contracts cho view năng lực nền tảng (`/pack/me`, capabilities): brand công ty + agent thuộc gói.
// Nền tảng chỉ lấy qua `packs.mount.ts` (luật platform-no-pack-internals).
export { companyBrandModule } from "./brand.mount";

/**
 * Agent thuộc gói (thẻ app). Gương `packs.pack_agents` (pack-contracts 0039: `assistant`) + agent gói gọi theo khoá
 * (`price-scout`, agent-call). hub_api chưa có SELECT `packs.pack_agents` — đọc bảng cần migration GRANT (việc còn lại
 * docs/specs/cr118-capabilities/tasks.md); giữ hằng một chỗ.
 */
export const PACK_AGENTS: ReadonlyMap<string, readonly string[]> = new Map([
  ["contracts", ["assistant", "price-scout"]],
]);
