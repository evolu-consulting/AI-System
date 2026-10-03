// ADM-FR-62, ADM-FR-32, ADM-FR-35, ADM-FR-36, ADM-FR-53, ADM-FR-55, ADM-BR-09 · contract M3 (spec §3; test-plan R1).
// Phần `User.groups` và `CommandAccessItem` mới ở contracts-users / contracts-commands (xanh ở T4/T6).
import { describe, expect, it } from "bun:test";
import {
  ACCESS_COMMANDS_MAX,
  ACCESS_REASONS,
  AccessReasonSchema,
  API_ERRORS,
  BETA_GROUP_KEY,
  COMMAND_MISSING,
  CONFIG_CHANNEL,
  CONFIG_ENTITIES,
  EffectiveAccessQuerySchema,
  EffectiveAccessSchema,
  FEATURE_MISSING,
  GRANT_BATCH_MAX,
  GROUP_DESC_MAX,
  GROUP_KEY_RE,
  GROUP_NAME_MAX,
  GROUP_PASTE_MAX,
  GrantBatchRequestSchema,
  GrantCreateRequestSchema,
  GrantDeleteQuerySchema,
  GrantMatrixQuerySchema,
  GrantMatrixSchema,
  GrantSchema,
  GroupCreateRequestSchema,
  GroupKeySchema,
  GroupListQuerySchema,
  GroupListResponseSchema,
  GroupMemberSchema,
  GroupMembersAddRequestSchema,
  GroupMembersAddResponseSchema,
  GroupUpdateRequestSchema,
  GroupVersionConflictDetailsSchema,
  InvalidReferenceDetailsSchema,
  MATRIX_COMMAND_NAMES_MAX,
  MATRIX_GROUPS_MAX,
  MATRIX_ROW_STATES,
  NotEntitledDetailsSchema,
  OTHER_GROUPS_MAX,
  parseUsernameList,
  REFERENCE_FIELDS,
  USER_BLOCKERS,
  USER_GROUPS_MAX,
  USERNAME_INPUT_MAX,
} from "@ai/contracts";

const ok = (r: { success: boolean }) => r.success;
const U = (n: number) => `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const [U1, U2, U3, U4] = [U(1), U(2), U(3), U(4)] as [string, string, string, string];
const pair = (f: string, g: string) => ({ feature_id: f, group_id: g });
const ref = { id: U1, key: "ke-toan", name: { vi: "Kế toán" }, is_beta: false };
const feat = { id: U2, key: "ke-toan", name: { vi: "Kế toán" }, status: "on", is_core: false };

describe("ADM-FR-62 · bảng mã lỗi và hằng M3", () => {
  it("ADM-FR-62 · M3 · API_ERRORS = 34 mã M1+M2 giữ nguyên + BETA_GROUP_PROTECTED 409 + NOT_ENTITLED 409; tập cũ giữ nguyên sau M4 (toMatchObject)", () => {
    expect(API_ERRORS.BETA_GROUP_PROTECTED).toBe(409);
    expect(API_ERRORS.NOT_ENTITLED).toBe(409);
    expect(API_ERRORS).toMatchObject({
      KEY_TAKEN: 409,
      CORE_FEATURE_PROTECTED: 409,
      INVALID_REFERENCE: 400,
      TENANT_REQUIRED: 400,
      VERSION_CONFLICT: 409,
      NOT_FOUND: 404,
      FORBIDDEN: 403,
      INTERNAL_ERROR: 500,
    });
    // M4 (Q2a, test-plan §5 K5): không đếm — tổng 48 mã kiểm ở M4/rules/contracts-cd.test.ts (D-K04).
  });

  it("ADM-FR-32 · M3-R07 · REFERENCE_FIELDS chứa 4 giá trị cũ + feature_id, group_id, user_id, group_ids; InvalidReferenceDetails nhận field mới", () => {
    for (const f of ["secret_id", "workflow_id", "feature_ids", "command_ids"]) {
      expect(REFERENCE_FIELDS as readonly string[]).toContain(f);
    }
    for (const f of ["feature_id", "group_id", "user_id", "group_ids"]) {
      expect(REFERENCE_FIELDS as readonly string[]).toContain(f);
      expect(ok(InvalidReferenceDetailsSchema.safeParse({ field: f, ids: [U1] }))).toBe(true);
    }
    expect(ok(InvalidReferenceDetailsSchema.safeParse({ field: "tenant_id", ids: [U1] }))).toBe(
      false,
    );
  });

  it("ADM-FR-62 · spec M3 §3 · hằng và enum đúng spec", () => {
    expect(BETA_GROUP_KEY).toBe("beta-testers");
    expect(GROUP_KEY_RE.test("ke-toan")).toBe(true);
    expect([GROUP_NAME_MAX, GROUP_DESC_MAX, GROUP_PASTE_MAX, USERNAME_INPUT_MAX]).toEqual([
      64, 400, 500, 64,
    ]);
    expect([USER_GROUPS_MAX, OTHER_GROUPS_MAX, GRANT_BATCH_MAX, MATRIX_GROUPS_MAX]).toEqual([
      50, 3, 200, 200,
    ]);
    expect([MATRIX_COMMAND_NAMES_MAX, ACCESS_COMMANDS_MAX, CONFIG_CHANNEL]).toEqual([
      10,
      1000,
      "config_changed",
    ]);
    expect([...MATRIX_ROW_STATES]).toEqual(["core", "entitled", "revoked", "none"]);
    expect([...ACCESS_REASONS]).toEqual(["core", "grant_user", "grant_group", "beta_member"]);
    expect([...USER_BLOCKERS]).toEqual(["user_inactive", "tenant_locked"]);
    expect([...FEATURE_MISSING]).toEqual([
      "user_inactive",
      "tenant_locked",
      "feature_off",
      "beta_not_member",
      "no_entitlement",
      "no_grant",
    ]);
    expect([...COMMAND_MISSING]).toEqual([
      "user_inactive",
      "tenant_locked",
      "command_disabled",
      "workflow_disabled",
      "no_effective_feature",
    ]);
    // M4 (Q2a, test-plan §5 K6): M4 chèn "quota" ngay trước "batch" (plan-contract §2.5) → 11 giá trị.
    const entities = [...CONFIG_ENTITIES] as string[];
    expect(entities).toEqual(
      expect.arrayContaining([
        "tenant",
        "user",
        "group",
        "grant",
        "feature",
        "entitlement",
        "workflow",
        "command",
        "secret",
        "batch",
        "quota",
      ]),
    );
    expect(entities).toHaveLength(11);
    expect(entities.indexOf("quota")).toBe(entities.indexOf("batch") - 1);
  });
});

describe("ADM-FR-62 · Group (M3-R01)", () => {
  it("ADM-FR-62 · M3-R01 · GroupKey: trim+lower; a, 33 ký tự, a_b, Có-dấu fail; 2 và 32 ok", () => {
    expect(GroupKeySchema.parse("  KE-TOAN ")).toBe("ke-toan");
    for (const bad of ["a", "k".repeat(33), "a_b", "Có-dấu", ""]) {
      expect(ok(GroupKeySchema.safeParse(bad))).toBe(false);
    }
    for (const good of ["ab", "k".repeat(32)])
      expect(ok(GroupKeySchema.safeParse(good))).toBe(true);
  });

  it("ADM-FR-62 · M3-R01 · GroupCreateRequest: name.vi thiếu/rỗng/65 fail, 64 ok; en rỗng bị bỏ; description 400 ok/401 fail/'' → null; khoá lạ fail", () => {
    const base = { key: "nhom", name: { vi: "Nhóm" } };
    expect(ok(GroupCreateRequestSchema.safeParse(base))).toBe(true);
    for (const bad of [{}, { vi: "" }, { vi: "x".repeat(65) }]) {
      expect(ok(GroupCreateRequestSchema.safeParse({ ...base, name: bad }))).toBe(false);
    }
    expect(ok(GroupCreateRequestSchema.safeParse({ ...base, name: { vi: "x".repeat(64) } }))).toBe(
      true,
    );
    expect(GroupCreateRequestSchema.parse({ ...base, name: { vi: "A", en: "" } }).name).toEqual({
      vi: "A",
    });
    expect(ok(GroupCreateRequestSchema.safeParse({ ...base, description: "d".repeat(400) }))).toBe(
      true,
    );
    expect(ok(GroupCreateRequestSchema.safeParse({ ...base, description: "d".repeat(401) }))).toBe(
      false,
    );
    expect(GroupCreateRequestSchema.parse({ ...base, description: "" }).description).toBeNull();
    expect(GroupCreateRequestSchema.parse(base).description).toBeNull();
    expect(ok(GroupCreateRequestSchema.safeParse({ ...base, extra: 1 }))).toBe(false);
  });

  it("ADM-FR-55 · M3-R01 · GroupUpdateRequest: cần version ≥ 1; có key → fail; description null ok; khoá lạ fail", () => {
    expect(ok(GroupUpdateRequestSchema.safeParse({ name: { vi: "A" } }))).toBe(false);
    expect(ok(GroupUpdateRequestSchema.safeParse({ version: 0 }))).toBe(false);
    expect(ok(GroupUpdateRequestSchema.safeParse({ version: 1 }))).toBe(true);
    expect(ok(GroupUpdateRequestSchema.safeParse({ version: 1, key: "moi" }))).toBe(false);
    expect(ok(GroupUpdateRequestSchema.safeParse({ version: 1, description: null }))).toBe(true);
    expect(ok(GroupUpdateRequestSchema.safeParse({ version: 1, extra: 1 }))).toBe(false);
  });

  it("ADM-FR-62 · M3-R23 · GroupListQuery có tenant_id uuid; GroupListResponse = {items,total} KHÔNG có counts", () => {
    expect(ok(GroupListQuerySchema.safeParse({ tenant_id: U1, q: "ke" }))).toBe(true);
    expect(ok(GroupListQuerySchema.safeParse({ tenant_id: "abc" }))).toBe(false);
    expect(ok(GroupListResponseSchema.safeParse({ items: [], total: 0 }))).toBe(true);
    expect(ok(GroupListResponseSchema.safeParse({ items: [], total: 0, counts: {} }))).toBe(false);
  });

  it("ADM-FR-62 · M3-R03 · GroupMembersAddRequest: rỗng fail, 1 và 500 ok, 501 fail; phần tử 64 ok/65 fail; chuẩn hoá; bỏ trùng; dry_run mặc định false; khoá lạ fail", () => {
    const mk = (n: number) => Array.from({ length: n }, (_, i) => `u${i}`);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: [] }))).toBe(false);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: mk(1) }))).toBe(true);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: mk(500) }))).toBe(true);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: mk(501) }))).toBe(false);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: ["x".repeat(64)] }))).toBe(true);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: ["x".repeat(65)] }))).toBe(false);
    const r = GroupMembersAddRequestSchema.parse({ usernames: [" LAN ", "lan", "Thu"] });
    expect(r.usernames).toEqual(["lan", "thu"]);
    expect(r.dry_run).toBe(false);
    expect(ok(GroupMembersAddRequestSchema.safeParse({ usernames: ["a"], extra: 1 }))).toBe(false);
  });

  it("ADM-FR-62 · M3-R03 · GroupMembersAddResponse strict {added,not_found,already}; GroupMember strict có other_groups ≤ 3 + other_groups_total", () => {
    expect(
      ok(GroupMembersAddResponseSchema.safeParse({ added: [], not_found: [], already: [] })),
    ).toBe(true);
    expect(ok(GroupMembersAddResponseSchema.safeParse({ added: [], not_found: [] }))).toBe(false);
    const m = {
      user_id: U1,
      username: "lan",
      display_name: "Lan",
      role: "member",
      status: "active",
      locked_by_tenant: false,
      last_login_at: null,
      added_at: "2026-10-01T09:00:00.000Z",
      added_by: "admin",
      other_groups: [ref],
      other_groups_total: 1,
    };
    expect(ok(GroupMemberSchema.safeParse(m))).toBe(true);
    expect(ok(GroupMemberSchema.safeParse({ ...m, other_groups: [ref, ref, ref, ref] }))).toBe(
      false,
    );
    expect(ok(GroupMemberSchema.safeParse({ ...m, extra: 1 }))).toBe(false);
  });

  it("ADM-FR-55 · M3-R18 · GroupVersionConflictDetails = {current: Group, updated_at}; thiếu trường fail", () => {
    expect(ok(GroupVersionConflictDetailsSchema.safeParse({ current: {}, updated_at: "x" }))).toBe(
      false,
    );
    expect(ok(GroupVersionConflictDetailsSchema.safeParse({}))).toBe(false);
  });
});

describe("ADM-FR-32 · Grant (M3-R07, R08)", () => {
  it("ADM-FR-32 · M3-R07 · GrantCreateRequest/DeleteQuery: đúng một trong group_id/user_id; feature_id không uuid fail", () => {
    expect(ok(GrantCreateRequestSchema.safeParse({ feature_id: U1, group_id: U2 }))).toBe(true);
    expect(ok(GrantCreateRequestSchema.safeParse({ feature_id: U1, user_id: U2 }))).toBe(true);
    expect(
      ok(GrantCreateRequestSchema.safeParse({ feature_id: U1, group_id: U2, user_id: U3 })),
    ).toBe(false);
    expect(ok(GrantCreateRequestSchema.safeParse({ feature_id: U1 }))).toBe(false);
    expect(ok(GrantCreateRequestSchema.safeParse({ feature_id: "abc", group_id: U2 }))).toBe(false);
    expect(ok(GrantDeleteQuerySchema.safeParse({ feature_id: U1, group_id: U2 }))).toBe(true);
    expect(ok(GrantDeleteQuerySchema.safeParse({ feature_id: U1 }))).toBe(false);
    expect(
      ok(GrantDeleteQuerySchema.safeParse({ feature_id: U1, group_id: U2, user_id: U3 })),
    ).toBe(false);
  });

  it("ADM-FR-35 · M3-R08 · GrantBatchRequest: add/remove mặc định []; tổng 0 fail, 200 ok, 201 fail", () => {
    const mk = (n: number, off = 0) =>
      Array.from({ length: n }, (_, i) => pair(U(100 + off + i), U(5000 + i)));
    expect(ok(GrantBatchRequestSchema.safeParse({}))).toBe(false);
    expect(ok(GrantBatchRequestSchema.safeParse({ add: mk(1) }))).toBe(true);
    expect(ok(GrantBatchRequestSchema.safeParse({ remove: mk(1) }))).toBe(true);
    expect(ok(GrantBatchRequestSchema.safeParse({ add: mk(200) }))).toBe(true);
    expect(ok(GrantBatchRequestSchema.safeParse({ add: mk(100), remove: mk(100, 1000) }))).toBe(
      true,
    );
    expect(ok(GrantBatchRequestSchema.safeParse({ add: mk(201) }))).toBe(false);
    expect(GrantBatchRequestSchema.parse({ add: mk(1) }).remove).toEqual([]);
  });

  it("ADM-FR-35 · M3-R08 · GrantBatchRequest: cặp trùng trong một mảng fail (path tới phần tử trùng); cặp ở cả add và remove fail; phần tử có user_id fail", () => {
    const a = pair(U1, U2);
    const dupAdd = GrantBatchRequestSchema.safeParse({ add: [a, pair(U3, U4), a] });
    expect(dupAdd.success).toBe(false);
    if (!dupAdd.success) {
      expect(dupAdd.error.issues.some((i) => i.path.join(".") === "add.2")).toBe(true);
    }
    expect(ok(GrantBatchRequestSchema.safeParse({ add: [a], remove: [a] }))).toBe(false);
    expect(ok(GrantBatchRequestSchema.safeParse({ add: [{ ...a, user_id: U3 }] }))).toBe(false);
  });

  it("ADM-FR-32 · M3-R07 · GrantSchema.subject là discriminated union group|user; thiếu type fail; entitled bắt buộc", () => {
    const base = {
      id: U1,
      tenant_id: U2,
      feature: feat,
      entitled: true,
      granted_at: "2026-10-01T09:00:00.000Z",
      granted_by: "binh",
    };
    expect(ok(GrantSchema.safeParse({ ...base, subject: { type: "group", group: ref } }))).toBe(
      true,
    );
    expect(
      ok(
        GrantSchema.safeParse({
          ...base,
          subject: { type: "user", user: { id: U3, username: "lan", display_name: "Lan" } },
        }),
      ),
    ).toBe(true);
    expect(ok(GrantSchema.safeParse({ ...base, subject: { group: ref } }))).toBe(false);
    const { entitled: _e, ...noEnt } = base;
    expect(ok(GrantSchema.safeParse({ ...noEnt, subject: { type: "group", group: ref } }))).toBe(
      false,
    );
  });

  it("ADM-FR-35 · M3-R09 · GrantMatrixQuery: limit 0/201 fail, mặc định 200; offset -1/100001 fail; GrantMatrix.features[].state ∈ MATRIX_ROW_STATES, command_names ≤ 10", () => {
    expect(GrantMatrixQuerySchema.parse({}).limit).toBe(200);
    expect(ok(GrantMatrixQuerySchema.safeParse({ limit: "0" }))).toBe(false);
    expect(ok(GrantMatrixQuerySchema.safeParse({ limit: "201" }))).toBe(false);
    expect(ok(GrantMatrixQuerySchema.safeParse({ offset: "-1" }))).toBe(false);
    expect(ok(GrantMatrixQuerySchema.safeParse({ offset: "100001" }))).toBe(false);
    const row = (state: string, names: string[]) => ({
      feature: feat,
      state,
      command_names: names,
      command_count: names.length,
      granted_group_ids: [],
    });
    const m = (r: unknown) => ({ tenant_id: U1, groups: [], group_total: 0, features: [r] });
    expect(ok(GrantMatrixSchema.safeParse(m(row("entitled", ["a1"]))))).toBe(true);
    expect(ok(GrantMatrixSchema.safeParse(m(row("weird", []))))).toBe(false);
    const eleven = Array.from({ length: 11 }, (_, i) => `cmd${i}`);
    expect(ok(GrantMatrixSchema.safeParse(m(row("entitled", eleven))))).toBe(false);
  });
});

describe("ADM-FR-36 · EffectiveAccess (M3-R11, R12)", () => {
  const user = {
    id: U1,
    username: "lan",
    display_name: "Lan",
    tenant_id: U2,
    tenant_key: "acme",
    status: "active",
    groups: [],
  };
  const base = {
    user,
    blockers: [],
    features: [],
    commands: [],
    command_total: 0,
    config_version: 3,
  };

  it("ADM-FR-36 · M3-R12 · EffectiveAccess strict: agents đúng {available:false} (thêm khoá/available:true fail)", () => {
    expect(ok(EffectiveAccessSchema.safeParse({ ...base, agents: { available: false } }))).toBe(
      true,
    );
    expect(ok(EffectiveAccessSchema.safeParse({ ...base, agents: { available: true } }))).toBe(
      false,
    );
    expect(
      ok(EffectiveAccessSchema.safeParse({ ...base, agents: { available: false, items: [] } })),
    ).toBe(false);
    expect(ok(EffectiveAccessSchema.safeParse(base))).toBe(false);
  });

  it("ADM-FR-36 · M3-R12 · EffectiveFeature: missing ⊂ FEATURE_MISSING và effective ⇔ missing rỗng; EffectiveCommand.suggestion null|{action:'grant_feature',feature}", () => {
    const f = (effective: boolean, missing: string[]) => ({
      feature: feat,
      effective,
      reasons: [],
      missing,
    });
    const acc = (features: unknown[], commands: unknown[] = []) => ({
      ...base,
      features,
      commands,
      agents: { available: false },
    });
    expect(ok(EffectiveAccessSchema.safeParse(acc([f(true, [])])))).toBe(true);
    expect(ok(EffectiveAccessSchema.safeParse(acc([f(false, ["no_grant"])])))).toBe(true);
    expect(ok(EffectiveAccessSchema.safeParse(acc([f(true, ["no_grant"])])))).toBe(false);
    expect(ok(EffectiveAccessSchema.safeParse(acc([f(false, ["weird"])])))).toBe(false);
    const mini = { id: U2, key: "ke-toan", name: { vi: "Kế toán" } };
    const c = (suggestion: unknown) => ({
      id: U3,
      name: "kiemtra-hoadon",
      aliases: [],
      description: { vi: "Kiểm tra" },
      visible: false,
      via: [],
      blocked_by: [{ feature: mini, missing: ["no_grant"] }],
      missing: ["no_effective_feature"],
      suggestion,
    });
    expect(ok(EffectiveAccessSchema.safeParse(acc([], [c(null)])))).toBe(true);
    expect(
      ok(EffectiveAccessSchema.safeParse(acc([], [c({ action: "grant_feature", feature: mini })]))),
    ).toBe(true);
    expect(
      ok(EffectiveAccessSchema.safeParse(acc([], [c({ action: "other", feature: mini })]))),
    ).toBe(false);
  });

  it("ADM-FR-36 · M3-R12 · EffectiveAccessQuery.command: ' /DICH ' → dich; a_b và 33 ký tự fail", () => {
    expect(EffectiveAccessQuerySchema.parse({ command: " /DICH " }).command).toBe("dich");
    expect(ok(EffectiveAccessQuerySchema.safeParse({ command: "a_b" }))).toBe(false);
    expect(ok(EffectiveAccessQuerySchema.safeParse({ command: "k".repeat(33) }))).toBe(false);
    expect(ok(EffectiveAccessQuerySchema.safeParse({}))).toBe(true);
  });

  it("ADM-FR-36 · M3-R12 · AccessReason discriminated union: grant_group bắt buộc group; core có group → fail", () => {
    expect(ok(AccessReasonSchema.safeParse({ code: "core" }))).toBe(true);
    expect(ok(AccessReasonSchema.safeParse({ code: "grant_group", group: ref }))).toBe(true);
    expect(ok(AccessReasonSchema.safeParse({ code: "grant_group" }))).toBe(false);
    expect(ok(AccessReasonSchema.safeParse({ code: "core", group: ref }))).toBe(false);
  });

  it("ADM-FR-32 · M3-R07 · NotEntitledDetails {feature_ids ≥ 1} strict", () => {
    expect(ok(NotEntitledDetailsSchema.safeParse({ feature_ids: [U1] }))).toBe(true);
    expect(ok(NotEntitledDetailsSchema.safeParse({ feature_ids: [] }))).toBe(false);
    expect(ok(NotEntitledDetailsSchema.safeParse({ feature_ids: [U1], extra: 1 }))).toBe(false);
  });
});

describe("ADM-FR-62 · parseUsernameList (M3-R03)", () => {
  it("ADM-FR-62 · M3-R03 · tách theo xuống dòng, phẩy, khoảng trắng, tab; trim; lower; bỏ rỗng; bỏ trùng giữ thứ tự đầu", () => {
    expect(parseUsernameList("Lan, thu\nBINH\t an  ,,lan")).toEqual(["lan", "thu", "binh", "an"]);
  });

  it("ADM-FR-62 · M3-R03 · chuỗi rỗng / chỉ dấu tách → []", () => {
    expect(parseUsernameList("")).toEqual([]);
    expect(parseUsernameList("  ,\n ,")).toEqual([]);
  });

  it("ADM-FR-62 · M3-R03 · không cắt 500: 10.000 mục khác nhau giữ nguyên, chạy < 50 ms", () => {
    const text = Array.from({ length: 10_000 }, (_, i) => `u${i}`).join("\n");
    const t0 = performance.now();
    const out = parseUsernameList(text);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(out).toHaveLength(10_000);
  });
});
