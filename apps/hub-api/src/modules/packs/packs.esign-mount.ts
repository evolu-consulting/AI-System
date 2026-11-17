// CR-181 · gắn webhook ký số của gói Hợp đồng kèm cổng tiêm hub: cờ «ký trên tài liệu» của công ty (gói không import module hub).
import { mountEsignWebhook as mountEsign } from "./contracts/esign.mount";
import { onDocEnabledOfTenant } from "./packs.tenant-config";

export const mountEsignWebhook: typeof mountEsign = (app, d) =>
  mountEsign(app, { ...d, ...(d.db ? { onDocEnabled: onDocEnabledOfTenant(d.db) } : {}) });
