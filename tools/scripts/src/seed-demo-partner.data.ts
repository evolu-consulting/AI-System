// CR-150 · dữ liệu + luật THUẦN của `seed-demo-partner.ts` (UAT hợp đồng 2 công ty trên bản test: demo = bên gửi, evolu = bên đối tác). KHÔNG I/O.
// Luật an toàn: phía evolu CHỈ THÊM (người dùng `uat-nhan-*`, nhóm `uat-nhan-*`, MỘT quy trình Nhận HĐ) — `planEvolu` không có hành động xoá/sửa; chạy lần 2 ⇒ kế hoạch rỗng.
import {
  approve,
  esignSend,
  esignWait,
  finish,
  norm,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { isStagingStack, seedDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";

export const DEMO_KEY = "demo";
export const EVOLU_KEY = "evolu";
/** Hồ sơ công ty chỉ điền khi CHƯA có mã số thuế (không ghi đè hồ sơ có sẵn). */
export const PROFILES = {
  [DEMO_KEY]: {
    legal_name: "Công ty Demo (UAT)",
    tax_code: "0100150001",
    address: "1 Phố Gửi, Hà Nội",
  },
  [EVOLU_KEY]: {
    legal_name: "Công ty Evolu (UAT đối tác)",
    tax_code: "0100150002",
    address: "2 Phố Nhận, Hà Nội",
  },
} as const;
export const PARTNER_FEATURE = "contracts-partner-confirm";
/** Người «thêm đối tác» ở demo (G3: khác người chọn đối tác khi gửi). */
export const PARTNER_ADDED_BY = "ha.ly";
/** Nhóm làm bước «Chọn đối tác & người nhận» ở demo (Pháp chế). */
export const PARTNER_PICK_GROUP = "pb-phap-che";
export const SIGN_GROUP_DEMO = "nguoi-ky-hd";
export const SIGN_PROVIDER = "upload";

// ── guard ──
/** Lý do TỪ CHỐI (null = được): bắt buộc stack staging `stg-test` (không cho chạy ở máy dev: script ghi vào công ty evolu) + DB host cho phép. */
export function partnerGuard(
  env: Record<string, string | undefined>,
  dbUrl: string,
): string | null {
  if (!isStagingStack(env))
    return "chỉ chạy trên stack staging stg-test (S2_STACK=stg-test + S2_PUBLIC_ADMIN_URL ai-test-admin.*, không APP_ENV=production)";
  return flowSeedGuard({
    appEnv: env.APP_ENV,
    urls: [dbUrl],
    iKnowProd: false,
    isLocal: seedDbHost(env),
  });
}

// ── người dùng + nhóm UAT phía evolu ──
export type UatUser = { username: string; name: string; pack: "owner" | "editor" };
export const EVOLU_USERS: readonly UatUser[] = [
  { username: "uat-nhan-gd", name: "Giám đốc nhận (UAT)", pack: "owner" },
  { username: "uat-nhan-phutrach", name: "Phụ trách HĐ nhận (UAT)", pack: "editor" },
  { username: "uat-nhan-duyet", name: "Người duyệt HĐ nhận (UAT)", pack: "editor" },
  { username: "uat-nhan-ky", name: "Người ký bên nhận (UAT)", pack: "editor" },
];
export const EVOLU_GROUPS: readonly { key: string; vi: string; members: readonly string[] }[] = [
  {
    key: "uat-nhan-duyet",
    vi: "UAT · Duyệt hợp đồng nhận",
    members: ["uat-nhan-duyet", "uat-nhan-gd"],
  },
  { key: "uat-nhan-ky", vi: "UAT · Ký hợp đồng nhận", members: ["uat-nhan-ky", "uat-nhan-gd"] },
];
export const PACK_GROUP_OF = { owner: "contracts-owner", editor: "contracts-editor" } as const;
/** Ngưỡng + tên quy trình Nhận HĐ (triệu đồng): 150 triệu = Thường, 400 triệu = Quan trọng, 1,2 tỷ = Rất quan trọng. */
export const RECEIVE = {
  name: "Nhận HĐ từ đối tác (UAT)",
  important_min_m: 300,
  critical_min_m: 1000,
  owner: "uat-nhan-phutrach",
} as const;

export type EvoluState = {
  /** tên đăng nhập đã có ở evolu */
  users: ReadonlySet<string>;
  /** mã nhóm → tên đăng nhập thành viên; nhóm chưa có ⇒ không có khoá */
  groups: ReadonlyMap<string, ReadonlySet<string>>;
};
export type EvoluAction =
  | { op: "create_user"; username: string; name: string }
  | { op: "create_group"; key: string; name: string }
  | { op: "add_member"; group: string; username: string };

/**
 * Kế hoạch THÊM cho evolu từ trạng thái hiện có. Không bao giờ sinh hành động xoá/sửa; người/nhóm đã có ⇒ không đụng (kể cả khác tên).
 * Nhóm gói `contracts-*` phải có sẵn (không tạo): thiếu ⇒ `missingPackGroups` do script báo lỗi.
 */
export function planEvolu(s: EvoluState): { actions: EvoluAction[]; missingPackGroups: string[] } {
  const members = (g: string): ReadonlySet<string> => s.groups.get(g) ?? new Set();
  const addMissing = (group: string, names: readonly string[]): EvoluAction[] =>
    names
      .filter((m) => !members(group).has(m))
      .map((username) => ({ op: "add_member", group, username }));
  const actions: EvoluAction[] = EVOLU_USERS.filter((u) => !s.users.has(u.username)).map((u) => ({
    op: "create_user",
    username: u.username,
    name: u.name,
  }));
  for (const g of EVOLU_GROUPS) {
    if (!s.groups.has(g.key)) actions.push({ op: "create_group", key: g.key, name: g.vi });
    actions.push(...addMissing(g.key, g.members));
  }
  const packs = Object.entries(PACK_GROUP_OF);
  const missingPackGroups = packs.map(([, k]) => k).filter((k) => !s.groups.has(k));
  // chỉ thêm người UAT của ta vào nhóm gói đã có; không gỡ ai
  for (const [role, key] of packs)
    if (s.groups.has(key))
      actions.push(
        ...addMissing(
          key,
          EVOLU_USERS.filter((u) => u.pack === role).map((u) => u.username),
        ),
      );
  return { actions, missingPackGroups };
}

// ── quy trình ──
type Json = Record<string, unknown>;
/** «Trưởng phòng duyệt» theo người đề xuất (`starter_head`). */
const headApprove = (step: number, to: { reject: number; ret: number }, o: Stage = {}) => {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve("truong-phong", "Trưởng phòng duyệt", step, "", to, {
    after: { ...after, approver_mode: "starter_head" },
    ...o,
  });
};
/** Trưởng một phòng (mã nhóm phòng ban) duyệt — chỉ trưởng phòng quyết. */
const deptHeadApprove = (
  key: string,
  name: string,
  step: number,
  dept: string,
  to: { reject: number; ret: number },
  next: number,
) =>
  approve(key, name, step, dept, to, {
    next_step: next,
    after: { ...reviewNew(dept), head_only: true, need: "head" },
  });

const AUTO = { kind: "auto", branch: [] };
const PICK_FIELDS = [
  {
    key: "partner_tax_code",
    label: "Đối tác",
    type: "select",
    required: true,
    options: [],
    options_from: "company_partners",
  },
  {
    key: "partner_email",
    label: "Email người nhận",
    type: "text",
    required: true,
    max_len: 254,
    format: "email",
  },
];
const partnerStage = (key: string, name: string, step: number, extra: Json): Stage => ({
  instruction: "",
  real_action: false,
  answerer: { kind: "starter" },
  timeout_s: 120,
  token_budget: null,
  sources: [],
  must_know: [],
  autofix: null,
  output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
  after: AUTO,
  node: "contracts.partner-send",
  key,
  name,
  step,
  ...extra,
});
/** Node «Gửi đối tác xác nhận» (3 bước: chọn đối tác → gửi → chờ trả lời), kênh nền tảng tới công ty đã nối. */
export function partnerSend(
  step: number,
  cfg: Json,
  go: { returned: number; declined: number },
): Stage[] {
  const consts = Object.fromEntries(
    Object.entries(cfg).map(([k, v]) => [k, { from: "const", value: v }]),
  );
  return [
    partnerStage("chon-doi-tac", "Chọn đối tác & người nhận", step, {
      executor: { kind: "form", fields: PICK_FIELDS },
    }),
    partnerStage("gui-doi-tac", "Gửi đối tác xác nhận", step + 1, {
      executor: {
        kind: "tool",
        tool_key: "contracts-partner-send",
        args: { contract_id: { from: "input", key: "contract_id" }, ...consts },
      },
      real_action: true,
    }),
    partnerStage("cho-doi-tac", "Chờ đối tác xác nhận", step + 2, {
      executor: {
        kind: "wait_event",
        event: "partner.confirmed",
        also_events: ["partner.returned", "partner.declined"],
        timeout_h: 168,
        branches: [
          { on: "partner.returned", goto_step: go.returned },
          { on: "partner.declined", goto_step: go.declined },
          { on: "timeout", goto_step: go.declined },
        ],
      },
    }),
  ];
}

/** Điền «Ký qua» + «Người ký phía công ty» cho mọi bước gửi ký (CR-146b: bắt buộc khi lưu). `signerGroupId` = id nhóm của chính công ty đó. */
export function withEsign(stages: unknown[], signerGroupId: string): unknown[] {
  return stages.map((s) => {
    const ex = (s as { executor?: { tool_key?: string; args?: Json } }).executor;
    if (ex?.tool_key !== "contracts-esign-send") return s;
    const args = {
      ...ex.args,
      provider: { from: "const", value: SIGN_PROVIDER },
      company_signers: { from: "const", value: `group:${signerGroupId}` },
    };
    return { ...(s as object), executor: { ...ex, args } };
  });
}

export type FlowDef = { name: string; trigger: Json; stages: unknown[] };
const PARTNER_CFG = {
  assignee_group: PARTNER_PICK_GROUP,
  send_fields: "total_value",
  reply_days: 7,
  message: "Xin quý công ty xác nhận hợp đồng",
};

/**
 * 3 quy trình duyệt của demo, xét TRƯỚC «Duyệt hợp đồng» (mọi HĐ còn lại). Điều kiện chỉ dùng dữ kiện luôn có (giá trị, phòng người tạo):
 *  A giá trị ≥ 500 triệu: Trưởng phòng → Giám đốc → Ký → Gửi đối tác (đề nghị ký cùng lúc) · B phòng Mua hàng: Trưởng phòng → Kế toán trưởng → Ký ·
 *  C phòng Kinh doanh: Trưởng phòng → Ký → Gửi đối tác. Người đầu tiên duyệt mỗi HĐ mẫu demo:org không đổi (xem `SAMPLES`).
 */
export function demoFlows(): FlowDef[] {
  const withTo = (rej: number, ret: number) => ({ reject: rej, ret });
  const A = norm([
    headApprove(0, withTo(8, 9)),
    deptHeadApprove("giam-doc", "Giám đốc duyệt", 1, "pb-giam-doc", withTo(8, 9), 2),
    { ...esignSend(2), name: "Ký hợp đồng" },
    esignWait(3, 8),
    ...partnerSend(
      4,
      { ...PARTNER_CFG, sign_together: true, sign_reason: "Cần ký gấp trong tuần" },
      { returned: 9, declined: 8 },
    ),
    finish(7, "approved", "Đã xác nhận"),
    finish(8, "rejected", "Từ chối"),
    finish(9, "returned", "Trả lại"),
  ]);
  const B = norm([
    headApprove(0, withTo(5, 6)),
    deptHeadApprove("ke-toan-truong", "Kế toán trưởng duyệt", 1, "pb-ke-toan", withTo(5, 6), 2),
    { ...esignSend(2), name: "Ký hợp đồng" },
    esignWait(3, 5),
    finish(4, "approved", "Đã duyệt"),
    finish(5, "rejected", "Từ chối"),
    finish(6, "returned", "Trả lại"),
  ]);
  const C = norm([
    headApprove(0, withTo(7, 8)),
    { ...esignSend(1), name: "Ký hợp đồng" },
    esignWait(2, 7),
    ...partnerSend(3, PARTNER_CFG, { returned: 8, declined: 7 }),
    finish(6, "approved", "Đã xác nhận"),
    finish(7, "rejected", "Từ chối"),
    finish(8, "returned", "Trả lại"),
  ]);
  const ev = "contract.submitted";
  return [
    {
      name: "UAT · HĐ từ 500 triệu",
      trigger: {
        event: ev,
        when: { op: "and", conds: [{ fact: "total_value", op: "ge", value: 500_000_000 }] },
      },
      stages: A,
    },
    {
      name: "UAT · HĐ phòng Mua hàng",
      trigger: {
        event: ev,
        when: {
          op: "and",
          conds: [{ fact: "creator_department", op: "in", value: ["pb-mua-hang"] }],
        },
      },
      stages: B,
    },
    {
      name: "UAT · HĐ phòng Kinh doanh gửi đối tác",
      trigger: {
        event: ev,
        when: {
          op: "and",
          conds: [{ fact: "creator_department", op: "in", value: ["pb-kinh-doanh"] }],
        },
      },
      stages: C,
    },
  ];
}

/** Quy trình «Nhận HĐ từ đối tác» của evolu: Duyệt (nhóm UAT) → Ký (nhóm UAT, tải bản đã ký) → Đồng ý; Từ chối / Trả lại. Ngưỡng + người phụ trách ở `trigger.params` (CR-146b). */
export function receiveFlow(ownerUserId: string): FlowDef {
  const to = { reject: 4, ret: 5 };
  const stages = norm([
    approve("nhan-duyet", "Duyệt hợp đồng nhận", 0, "uat-nhan-duyet", to),
    { ...esignSend(1), name: "Ký hợp đồng" },
    esignWait(2, 4),
    finish(3, "confirmed", "Đồng ý"),
    finish(4, "declined", "Từ chối"),
    finish(5, "returned", "Trả lại"),
  ]);
  return {
    name: RECEIVE.name,
    trigger: {
      event: "contract.received",
      params: {
        important_min_m: RECEIVE.important_min_m,
        critical_min_m: RECEIVE.critical_min_m,
        owner_user_id: ownerUserId,
      },
    },
    stages,
  };
}

/** Thứ tự xét cuối cùng: các quy trình UAT của ta (theo thứ tự khai) lên đầu, phần còn lại giữ thứ tự cũ. THUẦN. */
export function flowOrder(
  existingInOrder: readonly string[],
  mineInOrder: readonly string[],
): string[] {
  const mine = new Set(mineInOrder);
  return [...mineInOrder, ...existingInOrder.filter((id) => !mine.has(id))];
}

/** Người dùng UAT tạo mới: mật khẩu từ biến môi trường `UAT_EVOLU_PW` (file trên máy chủ, không in). */
export const evoluEmail = (username: string): string => `${username}@example.invalid`;
