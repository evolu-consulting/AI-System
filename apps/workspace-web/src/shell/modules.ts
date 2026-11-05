// CR-120 · danh sách module của AppShell — shell chỉ đọc manifest (luật web-shell-manifest-only). Thêm app = thêm một dòng ở đây.
import { communityManifest } from "~/modules/community/manifest";
import { contractsManifest } from "~/modules/contracts/manifest";
import type { ModuleManifest } from "~/shared/kernel/module-manifest";

export const MODULES: readonly ModuleManifest[] = [contractsManifest, communityManifest];

/** Gói mà FeatureGate cần nạp để dựng menu; `contracts` mặc định bật khi chưa có ảnh `/pack/me` (như trước CR-120). */
export const MODULE_PACKS: readonly string[] = MODULES.map((m) => m.requires.pack);
export const PACK_FALLBACKS: Readonly<Record<string, boolean>> = { contracts: true };
