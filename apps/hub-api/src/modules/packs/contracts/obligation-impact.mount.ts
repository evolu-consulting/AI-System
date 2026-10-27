// MS-impact · CR-101b (lớp 4 của gói): nối xem trước tác động xác nhận mốc — repo đầu đợt + kho (RLS người gọi), engine điểm hiện hành
// theo cờ `REPUTATION_ENGINE` (đọc mỗi lần gọi, như `rep-current.mount`). Dùng cho route `GET /obligations/:id/impact` và cho lệnh
// `settle` (lưu delta trên dòng sổ).
import type { Db } from "@ai/db";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import { deliveryRepo } from "./adapters/delivery.repo";
import { obligationImpactRepo } from "./adapters/obligation-impact.repo";
import { obligationImpact } from "./application/obligation-impact.usecase";
import type { RepEngine } from "./domain/rep-current.rules";
import { safeTimeZone } from "./reminders.mount";
import { envRepEngine, hd8Reads, v2eReads } from "./rep-current.mount";

export function obligationImpactOf(
  db: Db,
  d: {
    timeZoneOf: (tenantId: string) => Promise<string>;
    now?: () => Date;
    engine?: () => RepEngine;
  },
) {
  const now = d.now ?? (() => new Date());
  const reads = { timeZoneOf: d.timeZoneOf, now };
  return obligationImpact({
    uow: packTenantOnly(
      createPackUow(db, "contracts", (tx, t) => ({
        impact: obligationImpactRepo(tx, t),
        delivery: deliveryRepo(tx, t),
      })),
    ),
    v2e: v2eReads(db, reads),
    hd8: hd8Reads(db, reads),
    engine: d.engine ?? envRepEngine,
    timeZoneOf: safeTimeZone(d.timeZoneOf),
    now,
  });
}
