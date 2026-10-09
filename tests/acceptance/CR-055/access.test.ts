// CR-055 · HUB-FR-76 · ADM-FR-36 · command chưa gắn feature (featureIds []) không ai dùng được: Hub `usableCommands`
// loại nó (kể cả user có feature core + grant đầy đủ); Admin "Kiểm tra quyền" trả visible=false,
// missing ["no_effective_feature"], blocked_by [] (không thêm mã lý do mới — quyết định CR-055).
import { describe, expect, it } from "bun:test";
import { computeEffectiveAccess } from "../../../apps/admin-api/src/modules/access/access.rules";
import {
  type CommandAccessInput,
  usableCommands,
} from "../../../apps/hub-api/src/modules/commands/command-access.rules";
import { uid } from "../H2a/rules/_catalog";

const G = uid(11);
const CORE = uid(400);
const TR = uid(401);
const LONELY = uid(601);
const OK = uid(602);

const input = (): CommandAccessInput => ({
  user: { id: uid(1), active: true, lockedByTenant: false, tenantActive: true, groupIds: [G] },
  betaGroupId: null,
  features: [
    { id: CORE, key: "core", status: "on", entitled: false, grantGroupIds: [], grantUser: false },
    { id: TR, key: "translate", status: "on", entitled: true, grantGroupIds: [G], grantUser: true },
  ],
  commands: [
    { id: LONELY, enabled: true, workflowEnabled: true, featureIds: [] },
    { id: OK, enabled: true, workflowEnabled: true, featureIds: [CORE] },
  ],
});

describe("CR-055 · command chưa gắn feature không ai dùng được", () => {
  it("CR-055 · Hub usableCommands: chỉ command có feature hiệu lực; command featureIds [] bị loại", () => {
    expect(usableCommands(input()).map((u) => u.commandId)).toEqual([OK]);
  });

  it("CR-055 · Admin computeEffectiveAccess: command featureIds [] → visible false, missing [no_effective_feature], via/blocked_by rỗng, không gợi ý", () => {
    const r = computeEffectiveAccess(input());
    const lonely = r.commands.find((c) => c.commandId === LONELY);
    expect(lonely).toMatchObject({
      visible: false,
      missing: ["no_effective_feature"],
      via: [],
      blockedBy: [],
      suggestFeatureId: null,
    });
    expect(r.commands.find((c) => c.commandId === OK)?.visible).toBe(true);
  });
});
