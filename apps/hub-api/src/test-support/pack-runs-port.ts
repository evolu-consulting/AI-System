// CR-105 · CHỈ cho test int của gói: dựng cổng `PackRunsPort` THẬT của engine (ensureDef/resolveSlot/groupIdsOf trên DB) mà file
// test trong `modules/packs/**` không import thẳng `modules/processes/**` (depcruise pack-boundary) — cùng vai `tests/acceptance/**/_support`.
// Không dùng cho code chạy thật (`start`/`act`… cần đủ ProcessDeps — test tự giả).
import type { Db } from "../lib/db";
import type { PackToolCatalog } from "../modules/packs/kit/application/pack-tools.ports";
import type { ProcessDeps } from "../modules/processes/core/ports";
import { packRunsOf } from "../modules/processes/runs/pack-runs";

export const packRunsPortForTest = (db: Db, packTools: PackToolCatalog) =>
  packRunsOf({ db, packTools } as unknown as ProcessDeps);
