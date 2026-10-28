// M2-chat · lớp 4: đăng ký tool đọc của trợ lý (`adapters/assistant.tools.ts`) vào registry tool gói (N2). Tx = `PackUow` của gói
// `contracts` (role `contracts_rw`, RLS FORCE, `app.user_id` = người gọi) — cùng repo/use case với route HTTP; tool chỉ gọi
// use case ĐỌC (`listContracts`, `getContract`, `cksReads.customers`, `ledgerReads.payments/obligations`).
import type { Db, Tx } from "@ai/db";
import type { PackAccessView } from "../kit/adapters/pack-guard.middleware";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { PackToolDef } from "../kit/application/pack-tools.ports";
import { assistantTools } from "./adapters/assistant.tools";
import { contractsRepos } from "./adapters/contracts.repo";
import { deliveryRepo } from "./adapters/delivery.repo";
import { ledgerReadRepo } from "./adapters/ledger-read.repo";
import { ledgerWriteRepo } from "./adapters/ledger-write.repo";
import { priceTools } from "./adapters/price.tools";
import { getContract } from "./application/get-contract.usecase";
import { ledgerReads } from "./application/ledger.usecase";
import { listContracts } from "./application/list-contracts.usecase";
import { cksReadRepo } from "./cks/adapters/cks-read.repo";
import { cksWriteRepo } from "./cks/adapters/cks-write.repo";
import { cksReads } from "./cks/application/read.usecase";
import { hostBookModule } from "./host-book.mount";
import { supplierScores } from "./partners.mount";
import { safeTimeZone } from "./reminders.mount";

const KEY = "contracts";

export type AssistantMountDeps = {
  /** có ⇒ đăng ký thêm tool giá (com-c10a). */
  view?: PackAccessView;
  timeZoneOf: (tenantId: string) => Promise<string>;
  now?: () => Date;
};

export function contractsAssistantTools(db: Db, o: AssistantMountDeps): PackToolDef[] {
  const d = { ...o, timeZoneOf: safeTimeZone(o.timeZoneOf) };
  const now = d.now ?? (() => new Date());
  const uow = packTenantOnly(createPackUow(db, KEY, contractsRepos));
  const cksUow = packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({
      cks: { ...cksReadRepo(tx, t), ...cksWriteRepo(tx, t) },
    })),
  );
  const ledgerUow = packTenantOnly(
    createPackUow(db, KEY, (tx: Tx, t: string) => ({
      ledger: { ...ledgerWriteRepo(tx, t), ...ledgerReadRepo(tx, t) },
      delivery: deliveryRepo(tx, t),
    })),
  );
  const clock = { now, timeZoneOf: d.timeZoneOf, newId: () => crypto.randomUUID() };
  return assistantTools({
    list: listContracts({ uow }),
    detail: getContract({ uow }),
    cks: cksReads({ uow: cksUow, clock }),
    ledger: ledgerReads({ uow: ledgerUow, timeZoneOf: d.timeZoneOf, now }),
  });
}

/** com-c10a · tra giá / so sánh / tìm NCC trên cổng đọc sổ chủ quản; chỉ người nội bộ có quyền đọc gói (reader kiểm). */
export function mountPriceTools(
  db: Db,
  view: PackAccessView,
  tools: { register(t: PackToolDef): void } | undefined,
  d: Pick<AssistantMountDeps, "timeZoneOf">,
): void {
  if (!tools) return;
  const reader = hostBookModule(db, view, {
    reputation: supplierScores(db, d),
    timeZoneOf: d.timeZoneOf,
  });
  for (const t of priceTools(reader)) tools.register(t);
}

/** Gọi từ `mountContracts` khi app có registry tool gói. */
export function mountAssistantTools(
  db: Db,
  tools: { register(t: PackToolDef): void } | undefined,
  d: AssistantMountDeps,
): void {
  if (!tools) return;
  for (const t of contractsAssistantTools(db, d)) tools.register(t);
  if (d.view) mountPriceTools(db, d.view, tools, d);
}
