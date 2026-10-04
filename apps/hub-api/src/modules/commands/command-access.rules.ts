// HUB-FR-76, HUB-BR-06 · H2a P5, Q4 · lệnh user dùng được = `visible` của `computeEffectiveAccess` Admin
// (`apps/admin-api/src/modules/access/access.rules.ts`). CHÉP kiểu đầu vào, không import chéo app; test đối chiếu
// `tests/acceptance/H2a/rules/access-parity.test.ts`. Nợ: gộp `packages/access` khi combine. B0: chỉ chữ ký (B1).
import type { FeatureStatus } from "@ai/contracts";

export type AccessUser = {
  id: string;
  active: boolean;
  lockedByTenant: boolean;
  tenantActive: boolean;
  groupIds: readonly string[];
};
export type AccessFeature = {
  id: string;
  key: string;
  status: FeatureStatus;
  entitled: boolean;
  grantGroupIds: readonly string[];
  grantUser: boolean;
};
export type AccessCommand = {
  id: string;
  enabled: boolean;
  workflowEnabled: boolean;
  featureIds: readonly string[];
};
/** Trùng `AccessInput` Admin (cùng tên trường, cùng nghĩa). */
export type CommandAccessInput = {
  user: AccessUser;
  betaGroupId: string | null;
  features: readonly AccessFeature[];
  commands: readonly AccessCommand[];
};

export type UsableCommand = { commandId: string; featureId: string };

/** = `commands[].visible` Admin; `featureId` = feature hiệu lực có `key` nhỏ nhất (Q4). */
export function usableCommands(i: CommandAccessInput): UsableCommand[] {
  throw new Error(`not implemented: usableCommands(${i.commands.length})`);
}
