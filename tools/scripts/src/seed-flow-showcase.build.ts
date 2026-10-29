// CR-103 · R4 fnr-showcase · dựng def flow mẫu "Duyệt đề nghị chi (mẫu)" — THUẦN (không I/O), để dry-run in ra và test.
// Bước 0 `set` → bước 1 song song (Pháp chế ∥ Kế toán: `set` + cổng duyệt nhóm) → bước 2 `if` → bước 3 "Giám đốc duyệt"
// (review) / bước 4 "Hoàn tất". `set`/`if` CHƯA có trong union `executor` của contracts ⇒ def chỉ qua `ProcessDefInputSchema`
// sau phase B (R1 + R2 gộp); trả về kiểu lỏng (`unknown`), dry-run in kết quả kiểm để thấy điều đó.
import { FLOW_SHOWCASE_KEY } from "@ai/contracts/hub-admin";

export const SHOWCASE_NAME = "Duyệt đề nghị chi (mẫu)";
export const AMOUNT_LIMIT = 100_000_000;
export const PURPOSE_VALUE = "mua sắm";

/** Key Group demo mặc định (seed demo: `demo-ai-fix.people.ts`); ghi đè bằng cờ `--legal-group/--accounting-group/--director-group`. */
export const DEFAULT_GROUPS = {
  legal: "pb-kinh-doanh", // demo chưa có nhóm Pháp chế riêng ⇒ tạm dùng Kinh doanh
  accounting: "pb-ke-toan",
  director: "pb-giam-doc",
} as const;
export type GroupKeys = { [K in keyof typeof DEFAULT_GROUPS]: string };
export type GroupIds = { [K in keyof typeof DEFAULT_GROUPS]: string };

type Field = { key: string; type: "number" | "string" | "date"; required: boolean };

function stage(
  key: string,
  name: string,
  step: number,
  executor: unknown,
  fields: Field[],
  after: unknown,
) {
  return {
    key,
    name,
    step,
    executor,
    instruction: "",
    output: {
      filename: `${key}.md`,
      template: `# ${name}\n\n## Kết quả\n`,
      required_sections: ["Kết quả"],
      fields,
    },
    after,
    real_action: false,
    answerer: { kind: "starter" },
    timeout_s: 600,
    token_budget: null,
    sources: [],
    must_know: [],
    autofix: null,
  };
}

const auto = { kind: "auto", branch: [] };
const review = (groupId: string) => ({
  kind: "review",
  group_id: groupId,
  back_to_steps: [],
  remind_every_h: null,
  escalate: null,
  branch: [],
  exclude_starter: false,
});
const note = (key: string, value: string) => ({
  kind: "set",
  values: [{ key, from: { const: value } }],
});
const str = (key: string): Field => ({ key, type: "string", required: true });

/** Def flow mẫu (dạng input của `POST /process-defs`); `g` = id Group đã tra theo key. */
export function buildShowcaseDef(g: GroupIds) {
  return {
    key: FLOW_SHOWCASE_KEY,
    name: SHOWCASE_NAME,
    description:
      "Flow mẫu: nhập số tiền + mục đích → Pháp chế và Kế toán duyệt song song → nếu > 100 triệu và mua sắm thì Giám đốc duyệt, ngược lại hoàn tất.",
    input_hint: "",
    run_group_ids: [],
    stages: [
      stage(
        "nhap",
        "Nhập đề nghị",
        0,
        {
          kind: "set",
          values: [
            { key: "amount", from: { input: "amount" } },
            { key: "purpose", from: { input: "purpose" } },
          ],
        },
        [{ key: "amount", type: "number", required: true }, str("purpose")],
        auto,
      ),
      stage(
        "phap-che",
        "Pháp chế",
        1,
        note("y_kien", "Đã xem xét"),
        [str("y_kien")],
        review(g.legal),
      ),
      stage(
        "ke-toan",
        "Kế toán",
        1,
        note("y_kien", "Đã xem xét"),
        [str("y_kien")],
        review(g.accounting),
      ),
      stage(
        "kiem-tra",
        "Kiểm tra hạn mức",
        2,
        {
          kind: "if",
          when: {
            op: "and",
            conds: [
              { from: { kind: "input", key: "amount" }, op: "gt", value: AMOUNT_LIMIT },
              { from: { kind: "input", key: "purpose" }, op: "eq", value: PURPOSE_VALUE },
            ],
          },
          then_step: 3,
          else_step: 4,
        },
        [],
        auto,
      ),
      stage(
        "giam-doc",
        "Giám đốc duyệt",
        3,
        note("quyet_dinh", "Chờ Giám đốc"),
        [str("quyet_dinh")],
        review(g.director),
      ),
      stage("hoan-tat", "Hoàn tất", 4, note("ket_qua", "Hoàn tất"), [str("ket_qua")], auto),
    ],
    token_budget: null,
    enabled: true,
    sources: [],
    inputs: [
      { key: "amount", label: "Số tiền", type: "number", required: true },
      { key: "purpose", label: "Mục đích", type: "text", required: true },
    ],
  };
}
export type ShowcaseDef = ReturnType<typeof buildShowcaseDef>;

/** Lý do TỪ CHỐI chạy (null = được). Production hoặc DB host ngoài localhost/test ⇒ từ chối, trừ `--i-know-prod`. */
export function flowSeedGuard(o: {
  appEnv: string | undefined;
  urls: readonly string[];
  iKnowProd: boolean;
  isLocal: (url: string) => boolean;
}): string | null {
  if (o.iKnowProd) return null;
  if (o.appEnv === "production") return "APP_ENV=production — thêm --i-know-prod nếu thật sự chủ ý";
  return o.urls.some((u) => !o.isLocal(u))
    ? "DB host không thuộc localhost/test — thêm --i-know-prod nếu thật sự chủ ý"
    : null;
}
