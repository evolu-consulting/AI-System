// CR-121 Q-1 · lớp 4: đăng ký bộ đặt nhãn bản ghi của gói contracts vào registry kit (Hub hỏi theo tập id, không đọc bảng gói).
import type { Db } from "@ai/db";
import { createPackUow } from "../kit/adapters/pack-uow";
import { recordLabelRegistry } from "../kit/adapters/record-label-registry";
import type { RecordLabelSource } from "../kit/application/record-label.ports";
import { contractRecordLabel, recordLabelRepo } from "./adapters/record-label.repo";

export function contractsRecordLabelSource(db: Db): RecordLabelSource {
  const uow = createPackUow(db, "contracts", (tx, t) => ({ names: recordLabelRepo(tx, t) }));
  return {
    pack: "contracts",
    labels: (tenantId, ids) =>
      uow.system(tenantId, async (r) => {
        const rows = await r.names.contractNames(ids);
        return new Map(rows.map((x) => [x.id, contractRecordLabel(x)]));
      }),
  };
}

export const mountContractsRecordLabels = (db: Db): void =>
  recordLabelRegistry.register(contractsRecordLabelSource(db));
