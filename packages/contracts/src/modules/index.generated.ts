// CR-125 · m3 · TỰ SINH bởi `bun run module:index` — KHÔNG sửa tay. SỔ MODULE: danh sách node DUY NHẤT (MOD-FR-06),
// sinh từ thư mục `modules/<app>/<node>/node.ts`.
import { COMMUNITY_MODULE } from "./community/module";
import { CONTRACTS_MODULE } from "./contracts/module";
import { CORE_MODULE } from "./core";
import type { FeatureModule } from "./types";

export const MODULES: readonly FeatureModule[] = [CORE_MODULE, CONTRACTS_MODULE, COMMUNITY_MODULE];
