// CR-118 · cổng gói contracts cho view năng lực nền tảng (`/pack/me`, capabilities): brand công ty.
// Nền tảng chỉ lấy qua `packs.mount.ts` (luật platform-no-pack-internals). Agent của gói đọc từ `packs.pack_agents`
// qua ảnh ConfigCache (hub_api SELECT — packs 0009), không còn hằng ở đây.
export { companyBrandModule } from "./brand.mount";
