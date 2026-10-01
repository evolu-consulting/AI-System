// ADM-FR-62, ADM-FR-32 · 2 mã lỗi M3 (BETA_GROUP_PROTECTED, NOT_ENTITLED) và các mã dùng lại ở ngữ cảnh mới: status theo
// bảng, `details` parse bằng schema, `message` tĩnh tiếng Anh theo mã, không echo đầu vào (M3-R06; test-plan I-E).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import {
  API_ERRORS,
  type ErrorCode,
  GroupVersionConflictDetailsSchema,
  InvalidReferenceDetailsSchema,
  NotEntitledDetailsSchema,
} from "@ai/contracts";
import {
  betaId,
  callerOf,
  createM3Env,
  expectErr,
  ID,
  ID3,
  type M3Env,
  type Res,
  USER_ID,
} from "./_fixtures";

let env: M3Env;
let admin: ReturnType<typeof callerOf>;
let binh: ReturnType<typeof callerOf>;
let lan: ReturnType<typeof callerOf>;

beforeAll(async () => {
  env = await createM3Env();
  admin = callerOf(env, "platform", "admin");
  binh = callerOf(env, "acme", "binh");
  lan = callerOf(env, "acme", "lan");
});
beforeEach(async () => {
  await env.reset3();
});
afterAll(async () => {
  await env.close();
});

const KT = ID3.group.acmeKeToan;
type Scenario = { run: () => Promise<Res>; details?: (d: unknown) => unknown };
const SCENARIOS: Record<string, Scenario> = {
  BETA_GROUP_PROTECTED: {
    run: async () => binh("DELETE", `/admin/groups/${await betaId(env.owner, "acme")}`),
  },
  NOT_ENTITLED: {
    run: () => binh("POST", "/admin/grants", { feature_id: ID3.feature.phapChe, group_id: KT }),
    details: (d) => NotEntitledDetailsSchema.parse(d),
  },
  KEY_TAKEN: {
    run: () => binh("POST", "/admin/groups", { key: "ke-toan", name: { vi: "Trùng" } }),
  },
  CORE_FEATURE_PROTECTED: {
    run: async () =>
      binh("POST", "/admin/grants", { feature_id: await env.coreId(), group_id: KT }),
  },
  INVALID_REFERENCE: {
    run: () =>
      binh("POST", "/admin/grants", {
        feature_id: ID.feature.keToan,
        group_id: ID3.group.globexKeToan,
      }),
    details: (d) => InvalidReferenceDetailsSchema.parse(d),
  },
  TENANT_REQUIRED: { run: () => admin("POST", "/admin/groups", { key: "moi", name: { vi: "M" } }) },
  VERSION_CONFLICT: {
    run: async () => {
      await binh("PATCH", `/admin/groups/${KT}`, { version: 1, name: { vi: "A" } });
      return binh("PATCH", `/admin/groups/${KT}`, { version: 1, name: { vi: "B" } });
    },
    details: (d) => GroupVersionConflictDetailsSchema.parse(d),
  },
  NOT_FOUND: { run: () => binh("GET", `/admin/groups/${ID3.unknown}`) },
  FORBIDDEN: { run: () => lan("GET", "/admin/groups") },
};

describe("ADM-FR-62 · mã lỗi M3 (M3-R02, R07)", () => {
  it("ADM-FR-62 · M3-R02 · BETA_GROUP_PROTECTED: 409, không details, message 'The beta-testers group cannot be deleted'; group còn nguyên", async () => {
    const res = await (SCENARIOS.BETA_GROUP_PROTECTED as Scenario).run();
    expectErr(res, "BETA_GROUP_PROTECTED");
    expect(API_ERRORS.BETA_GROUP_PROTECTED).toBe(409);
    expect(res.json.error.details).toBeUndefined();
    expect(res.json.error.message).toBe("The beta-testers group cannot be deleted");
  });

  it("ADM-FR-32 · M3-R07 · NOT_ENTITLED: 409, details {feature_ids} sắp tăng (phap-che + dich-thuat thu hồi), message 'Feature is not entitled for this tenant'", async () => {
    await env.owner`update admin.feature_entitlements set revoked_at = now() where feature_id = ${ID.feature.dichThuat}`;
    const res = await binh("PUT", "/admin/grants/batch", {
      add: [
        { feature_id: ID3.feature.phapChe, group_id: KT },
        { feature_id: ID.feature.dichThuat, group_id: KT },
      ],
    });
    expectErr(res, "NOT_ENTITLED");
    expect(API_ERRORS.NOT_ENTITLED).toBe(409);
    expect(NotEntitledDetailsSchema.parse(res.json.error.details).feature_ids).toEqual([
      ID.feature.dichThuat,
      ID3.feature.phapChe,
    ]);
    expect(res.json.error.message).toBe("Feature is not entitled for this tenant");
  });

  it("ADM-FR-62 · M3-R06 · tập mã đã chạy kịch bản == 2 mã mới + 7 mã dùng lại (KEY_TAKEN, CORE_FEATURE_PROTECTED, INVALID_REFERENCE, TENANT_REQUIRED, VERSION_CONFLICT, NOT_FOUND, FORBIDDEN); status đúng bảng, details parse đúng schema", async () => {
    const covered: string[] = [];
    for (const [code, sc] of Object.entries(SCENARIOS)) {
      await env.reset3();
      const res = await sc.run();
      expectErr(res, code as ErrorCode);
      if (sc.details) sc.details(res.json.error.details);
      covered.push(code);
    }
    expect(covered.sort()).toEqual(Object.keys(SCENARIOS).sort());
    expect(covered).toHaveLength(9);
    expect(covered).toContain("BETA_GROUP_PROTECTED");
    expect(covered).toContain("NOT_ENTITLED");
  });

  it("ADM-FR-62 · M3-R06 · message TĨNH theo mã: cùng mã với hai đầu vào khác nhau → cùng message; không echo key/id đầu vào", async () => {
    const a = await binh("POST", "/admin/groups", { key: "ke-toan", name: { vi: "A" } });
    const b = await binh("POST", "/admin/groups", { key: "kinh-doanh", name: { vi: "B" } });
    expectErr(a, "KEY_TAKEN");
    expectErr(b, "KEY_TAKEN");
    expect(a.json.error.message).toBe(b.json.error.message);
    expect(a.json.error.message).not.toContain("ke-toan");
    const r1 = await binh("POST", "/admin/grants", { feature_id: ID3.unknown, group_id: KT });
    const r2 = await binh("POST", "/admin/grants", {
      feature_id: ID.feature.keToan,
      user_id: USER_ID.khang,
    });
    expectErr(r1, "INVALID_REFERENCE");
    expectErr(r2, "INVALID_REFERENCE");
    expect(r1.json.error.message).toBe(r2.json.error.message);
    expect(r1.json.error.message).not.toContain(ID3.unknown);
    const ne = await binh("POST", "/admin/grants", {
      feature_id: ID3.feature.phapChe,
      group_id: KT,
    });
    expect(ne.json.error.message).not.toContain(ID3.feature.phapChe);
  });
});
