// dlc-agent-flows · đọc cho section "Quy trình DLC" của Sửa agent: def thư viện đã xuất bản của 3 khe DLC (một tx read only, scope
// system) + tool gói agent gắn được (registry, 0 SQL).
import type { DlcFlowList, PackToolList } from "@ai/contracts/studio";
import { withHubScope } from "@ai/db/hub-scope";
import type { Db } from "../../../lib/db";
import { DLC_FLOW_SLOTS, toDlcFlowList } from "./dlc-flows.map";
import { publishedSlotDefs } from "./dlc-flows.repo";

export type AgentPackTools = { forAgents?(): PackToolList["items"] };

export class DlcFlowsService {
  constructor(private readonly d: { db: Db; packTools?: AgentPackTools }) {}

  async flows(): Promise<DlcFlowList> {
    const rows = await withHubScope(
      this.d.db,
      { kind: "system" },
      (tx) => publishedSlotDefs(tx, DLC_FLOW_SLOTS),
      { accessMode: "read only" },
    );
    return toDlcFlowList(rows);
  }

  packTools(): PackToolList {
    return { items: this.d.packTools?.forAgents?.() ?? [] };
  }
}
