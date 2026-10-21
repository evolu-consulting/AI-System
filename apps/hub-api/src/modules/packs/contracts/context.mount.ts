// one-agent · lớp 4: nguồn nhãn ngữ cảnh của gói contracts (`ContextSource`) cho khối ngữ cảnh dock trợ lý. Tx = `PackUow` của
// gói (role `contracts_rw`, RLS FORCE, `app.user_id` = NGƯỜI GỌI) ⇒ chỉ nhãn bản ghi người đó mở được trên giao diện.
import type { Db } from "@ai/db";
import { createPackUow, packTenantOnly } from "../kit/adapters/pack-uow";
import type { ContextSource } from "../kit/application/context.ports";
import { type ContractLabelRow, contextLabelRepo } from "./adapters/context-label.repo";

/** `Hợp đồng "<tên>" (số …, hết hạn …)` — phần thiếu bỏ. */
export function contractLabel(r: ContractLabelRow): string {
  const extra = [r.number && `số ${r.number}`, r.end_date && `hết hạn ${r.end_date}`].filter(
    Boolean,
  );
  return `Hợp đồng "${r.title}"${extra.length ? ` (${extra.join(", ")})` : ""}`;
}

export function contractsContextSource(db: Db): ContextSource {
  const uow = packTenantOnly(
    createPackUow(db, "contracts", (tx, t) => ({ labels: contextLabelRepo(tx, t) })),
  );
  return {
    pack: "contracts",
    kinds: ["contract", "partner"],
    label: (who, kind, id) =>
      uow.tenant(who, async (r) => {
        if (kind === "contract") {
          const c = await r.labels.contract(id);
          return c && contractLabel(c);
        }
        const name = await r.labels.partner(id);
        return name && `Đối tác "${name}"`;
      }),
  };
}

/** Gọi từ `mountPacks` khi app có registry tool gói. */
export function mountContractsContext(
  db: Db,
  reg: { registerContext(s: ContextSource): void } | undefined,
): void {
  reg?.registerContext(contractsContextSource(db));
}
