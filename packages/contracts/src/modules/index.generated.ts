// CR-125 · m1 · SỔ MODULE — danh sách node DUY NHẤT (MOD-FR-06). m1 viết tay; lát m3 (`bun run module:index`) sẽ sinh file này
// từ thư mục `modules/<app>/<node>/node.ts`.
import { COMMUNITY_MODULE } from "./community/module";
import { CONTRACTS_MODULE } from "./contracts/module";
import { CORE_MODULE } from "./core";
import type { FeatureModule } from "./types";

export const MODULES: readonly FeatureModule[] = [CORE_MODULE, CONTRACTS_MODULE, COMMUNITY_MODULE];
