// CR-181 · s16 · dữ liệu + luật THUẦN của `seed-cr181-sign.ts` (UAT «Ký trên tài liệu» trên tenant demo của bản test). KHÔNG I/O mạng/DB (chỉ đọc phông + sinh PDF trong bộ nhớ).
// Luật an toàn: chỉ THÊM (bật cờ, thêm quy trình mới theo tên, thêm HĐ Nháp mới theo id cố định); không tạo chữ ký sẵn cho ai.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { PDFFont } from "../../../apps/hub-api/node_modules/pdf-lib";
import {
  approve,
  esignSend,
  esignWait,
  finish,
  norm,
  reviewNew,
  type Stage,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import { SIGNATURE_SETTINGS_DEFAULT } from "../../../packages/contracts/src/signature";
import { seedDbHost } from "./seed-community-demo.guard";
import { flowSeedGuard } from "./seed-flow-showcase.build";

export const SIGN_TENANT = "demo";
export const SIGN_FLOW_NAME = "Duyệt và ký hợp đồng (ký trên tài liệu)";
/** Giá trị «ondoc» của bước Ký (Q1, `EsignNodeConfigSchema.provider`). */
export const SIGN_PROVIDER_ONDOC = "ondoc";
export const SIGN_SIGNER_GROUP = "nguoi-ky-hd";
/** Người tạo HĐ mẫu = sale demo (phòng Kinh doanh, trưởng phòng `binh.tran`); người ký công ty = nhóm có `demo-owner`. */
export const SIGN_SALE = "cuong.le";
export const SIGN_CONTRACT_ID = "c1810000-0000-4000-8000-000000000016";
export const SIGN_CONTRACT_TITLE = "HĐ mẫu · Ký trên tài liệu (CR-181)";
/** Giá trị HĐ mẫu: dưới ngưỡng của quy trình demo ⇒ quy trình mới được chọn (xem `signFlowTrigger`). */
export const SIGN_CONTRACT_VALUE = 80_000_000;
export const SIGN_VALUE_MAX = 100_000_000;
export const SIGN_PARTNER = {
  name: "Công ty Evolu (UAT đối tác)",
  tax: "0100150002",
  email: "thomas.tran@example.invalid",
};
export const SIGN_SELF = { name: "Công ty Demo (UAT)", tax: "0100150001" };

/** Lý do TỪ CHỐI (null = được): không production; DB là localhost/test, hoặc `pg` CHỈ khi là stack stg-test (guard sẵn có). */
export function signSeedGuard(
  env: Record<string, string | undefined>,
  dbUrl: string,
): string | null {
  return flowSeedGuard({
    appEnv: env.APP_ENV,
    urls: [dbUrl],
    iKnowProd: false,
    isLocal: seedDbHost(env),
  });
}

/** Thiết lập ký của demo: bật `on_doc_enabled`, mọi trường khác giữ mặc định (Q5). Thay cả bộ qua PUT (strict). */
export const signSettingsBody = () => ({ ...SIGNATURE_SETTINGS_DEFAULT, on_doc_enabled: true });
export const signSettingsNeeded = (cur: { on_doc_enabled: boolean } | null): boolean =>
  !cur?.on_doc_enabled;

/** Điều kiện chọn quy trình: phòng Kinh doanh VÀ giá trị ≤ 100 triệu (HĐ UAT hai công ty ≥ 150 triệu nên không bị tranh). Quy trình này phải đứng ĐẦU thứ tự. */
export const signFlowTrigger = () => ({
  event: "contract.submitted",
  when: {
    op: "and",
    conds: [
      { fact: "creator_department", op: "in", value: ["pb-kinh-doanh"] },
      { fact: "total_value", op: "le", value: SIGN_VALUE_MAX },
    ],
  },
});

const headApprove = (step: number, to: { reject: number; ret: number }): Stage => {
  const { group_key: _k, ...after } = reviewNew("") as Record<string, unknown>;
  return approve("truong-phong", "Trưởng phòng duyệt", step, "", to, {
    // `reviewNew` đã có bằng chứng «ý kiến + tệp/chữ ký» (`evidence: opinion_plus`, CR-127 Z2)
    after: { ...after, approver_mode: "starter_head" },
  });
};

/** Trưởng phòng duyệt (ý kiến + chữ ký) → Ký `ondoc` → Chờ ký xong → Kết thúc (+ Từ chối / Trả lại). Người ký điền ở `withOnDocSigner`. */
export const signFlowStages = (): unknown[] => {
  const to = { reject: 4, ret: 5 };
  return norm([
    headApprove(0, to),
    { ...esignSend(1), name: "Ký hợp đồng" },
    esignWait(2, 4),
    finish(3, "approved", "Đã ký"),
    finish(4, "rejected", "Từ chối"),
    finish(5, "returned", "Trả lại"),
  ]);
};

/** Bước Ký: «Ký qua» = `ondoc`; người ký phía công ty = nhóm `nguoi-ky-hd` (giám đốc demo). */
export function withOnDocSigner(stages: unknown[], signerGroupId: string): unknown[] {
  return stages.map((s) => {
    const ex = (s as { executor?: { tool_key?: string; args?: Record<string, unknown> } }).executor;
    if (ex?.tool_key !== "contracts-esign-send") return s;
    const args = {
      ...ex.args,
      provider: { from: "const", value: SIGN_PROVIDER_ONDOC },
      company_signers: { from: "const", value: `group:${signerGroupId}` },
    };
    return { ...(s as object), executor: { ...ex, args } };
  });
}

/** Thứ tự xét quy trình: quy trình mới lên đầu, còn lại giữ nguyên thứ tự hiện có. */
export function signFlowOrder(existingInOrder: readonly string[], mine: string): string[] {
  return [mine, ...existingInOrder.filter((id) => id !== mine)];
}

// ── PDF mẫu ──
// `pdf-lib` + fontkit là phụ thuộc của hub-api (không khai ở tools/scripts, không thêm thư viện mới) ⇒ nạp theo vị trí package của hub-api.
type PdfLib = typeof import("../../../apps/hub-api/node_modules/pdf-lib");
const hubRequire = createRequire(new URL("../../../apps/hub-api/package.json", import.meta.url));
const { PDFDocument, rgb } = hubRequire("pdf-lib") as PdfLib;
const fontkit = hubRequire("@pdf-lib/fontkit");
const FONT_DIR = new URL(
  "../../../apps/hub-api/src/modules/packs/contracts/adapters/fonts/",
  import.meta.url,
);
export type SamplePdf = { bytes: Uint8Array; pages: number; texts: string[][] };

const SIGN_HINT = "(Ký, ghi rõ họ tên)";
type Spec = { title: string; pages: string[][]; lastPageSign: boolean };

const clause = (n: number, what: string): string[] => [
  `Điều ${n}. ${what}`,
  "Hai bên thống nhất các nội dung dưới đây và cam kết thực hiện đúng, đủ, đúng hạn.",
  "Mọi thay đổi phải lập thành văn bản và được đại diện hợp pháp của hai bên ký xác nhận.",
  "Tranh chấp được giải quyết trước hết bằng thương lượng; không thành thì đưa ra toà án.",
];
export const CONTRACT_SPEC: Spec = {
  title: "HỢP ĐỒNG HỢP TÁC (MẪU UAT)",
  lastPageSign: true,
  pages: [
    [
      `Bên A: ${SIGN_SELF.name} · MST ${SIGN_SELF.tax}`,
      `Bên B: ${SIGN_PARTNER.name} · MST ${SIGN_PARTNER.tax}`,
      ...clause(1, "Đối tượng hợp đồng"),
    ],
    clause(2, "Giá trị và phương thức thanh toán"),
    clause(3, "Thời hạn và tiến độ thực hiện"),
    clause(4, "Quyền và nghĩa vụ của Bên A"),
    clause(5, "Quyền và nghĩa vụ của Bên B"),
    [
      "Điều 6. Điều khoản chung",
      "Hợp đồng lập thành hai bản, mỗi bên giữ một bản, có giá trị như nhau.",
    ],
  ],
};
export const ANNEX_SPEC: Spec = {
  title: "PHỤ LỤC 01 (MẪU UAT)",
  lastPageSign: false,
  pages: [
    [
      "1. Danh mục công việc",
      "Hạng mục 1: khảo sát nhu cầu.",
      "Hạng mục 2: triển khai thử nghiệm.",
      "Hạng mục 3: nghiệm thu.",
    ],
    [
      "2. Tiến độ",
      "Tuần 1-2: khảo sát. Tuần 3-6: triển khai. Tuần 7: nghiệm thu.",
      "Phụ lục là một phần không tách rời của hợp đồng.",
    ],
  ],
};

async function render(spec: Spec): Promise<SamplePdf> {
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  const regular: PDFFont = await doc.embedFont(
    readFileSync(new URL("BeVietnamPro-Regular.ttf", FONT_DIR)),
  );
  const bold: PDFFont = await doc.embedFont(
    readFileSync(new URL("BeVietnamPro-Bold.ttf", FONT_DIR)),
  );
  const texts: string[][] = [];
  spec.pages.forEach((lines, i) => {
    const page = doc.addPage([595, 842]);
    const out: string[] = [];
    const put = (t: string, x: number, y: number, size: number, f: PDFFont) => {
      page.drawText(t, { x, y, size, font: f, color: rgb(0, 0, 0) });
      out.push(t);
    };
    put(`${spec.title} · trang ${i + 1}/${spec.pages.length}`, 56, 790, 14, bold);
    lines.forEach((t, k) => {
      put(t, 56, 740 - k * 26, 11, regular);
    });
    if (spec.lastPageSign && i === spec.pages.length - 1) {
      put("ĐẠI DIỆN BÊN A", 70, 420, 12, bold);
      put("ĐẠI DIỆN BÊN B", 360, 420, 12, bold);
      put(SIGN_HINT, 78, 400, 10, regular);
      put(SIGN_HINT, 368, 400, 10, regular);
    }
    texts.push(out);
  });
  return { bytes: await doc.save(), pages: spec.pages.length, texts };
}
export const contractPdf = (): Promise<SamplePdf> => render(CONTRACT_SPEC);
export const annexPdf = (): Promise<SamplePdf> => render(ANNEX_SPEC);

/** Kế hoạch idempotent của HĐ mẫu: đã rời Nháp ⇒ không làm gì; tệp chỉ tải khi chưa có tệp cùng tên. */
export type SignSampleState = {
  exists: boolean;
  status: string | null;
  fileNames: string[];
  /** HĐ đã có tệp CHÍNH (`contracts.file_id`)? vắng ⇒ coi là chưa (HĐ mới). */
  hasMain?: boolean;
  /** Đối tác đã có liên hệ CÓ email trong sổ đối tác (Bên B của «Tự đặt theo ĐẠI DIỆN BÊN B»)? vắng ⇒ chưa. */
  hasPartnerContact?: boolean;
};
export type SignSampleStep =
  | "create"
  | "file_contract"
  | "promote_main"
  | "file_annex"
  | "partner_contact";
export const CONTRACT_FILE = "hop-dong-hop-tac-mau.pdf";
export const ANNEX_FILE = "phu-luc-01-mau.pdf";
export function planSignSample(st: SignSampleState): SignSampleStep[] {
  if (st.exists && st.status !== "draft") return [];
  const steps: SignSampleStep[] = [];
  if (!st.exists) steps.push("create");
  if (!st.fileNames.includes(CONTRACT_FILE)) steps.push("file_contract");
  // Q14: «Cần ký» mặc định bật cho tệp CHÍNH ⇒ hợp đồng mẫu phải là tệp chính của HĐ, không phải tệp kèm.
  if (!st.hasMain) steps.push("promote_main");
  if (!st.fileNames.includes(ANNEX_FILE)) steps.push("file_annex");
  if (!st.hasPartnerContact) steps.push("partner_contact");
  return steps;
}

/** Khoá đối tác như `contracts.partner_role_of` (mã số thuế). */
export const signPartnerKey = (): string => `tax:${SIGN_PARTNER.tax}`;

/** Người ký công ty (giám đốc demo) phải thuộc nhóm `nguoi-ky-hd`: chưa có ⇒ cần thêm (chỉ thêm, không bớt ai). */
export const SIGN_SIGNER_USER = "demo-owner";
export const signerNeedsAdd = (memberUsernames: readonly string[]): boolean =>
  !memberUsernames.includes(SIGN_SIGNER_USER);
