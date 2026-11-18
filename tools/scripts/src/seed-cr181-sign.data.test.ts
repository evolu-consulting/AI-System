import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { SignatureSettingsSchema } from "../../../packages/contracts/src/signature";
import {
  ANNEX_FILE,
  annexPdf,
  CONTRACT_FILE,
  contractPdf,
  dailySampleTarget,
  pickSampleTarget,
  planSignSample,
  ROLE_REVIEW,
  ROLE_SIGN,
  ROLE_SPARE,
  roleAssignPlan,
  SIGN_ID_PREFIX,
  SIGN_PARTNER,
  signerNeedsAdd,
  signFlow2Stages,
  signFlow2Trigger,
  signFlowOrder,
  signFlowStages,
  signFlowTrigger,
  signPartnerKey,
  signSampleFields,
  signSeedGuard,
  signSettingsBody,
  signSettingsNeeded,
  withSignerRole,
} from "./seed-cr181-sign.data";

const { PDFDocument } = createRequire(
  new URL("../../../apps/hub-api/package.json", import.meta.url),
)("pdf-lib") as typeof import("../../../apps/hub-api/node_modules/pdf-lib");
const stg = { S2_STACK: "stg-test", S2_PUBLIC_ADMIN_URL: "https://ai-test-admin.example.com" };

describe("guard", () => {
  it("cho stg-test (pg) và máy dev (localhost)", () => {
    expect(signSeedGuard(stg, "postgres://u@pg:5432/x")).toBeNull();
    expect(signSeedGuard({}, "postgres://u@localhost:5432/x")).toBeNull();
  });
  it("từ chối production và DB ngoài", () => {
    expect(signSeedGuard({ ...stg, APP_ENV: "production" }, "postgres://u@pg/x")).not.toBeNull();
    expect(signSeedGuard({}, "postgres://u@pg:5432/x")).not.toBeNull();
    expect(signSeedGuard({}, "postgres://u@db.prod.example.com/x")).not.toBeNull();
  });
});

describe("thiết lập", () => {
  it("đúng schema, chỉ bật on_doc, còn lại mặc định", () => {
    const b = signSettingsBody();
    expect(SignatureSettingsSchema.safeParse(b).success).toBe(true);
    expect(b.on_doc_enabled).toBe(true);
    expect(b.digital_enabled).toBe(false);
    expect(signSettingsNeeded({ on_doc_enabled: true })).toBe(false);
    expect(signSettingsNeeded(null)).toBe(true);
  });
});

describe("quy trình theo vai (CR-182)", () => {
  type S = {
    executor?: { tool_key?: string; args?: Record<string, { value: string }> };
    after?: { role?: { key: string; label: string }; approver_mode?: string; group_id?: unknown };
  };
  const stages = signFlowStages() as S[];
  it("bước Duyệt = vai «Trưởng phòng duyệt», không nhóm/«trưởng phòng người đề xuất»", () => {
    const a = stages.find((x) => x.after?.role)?.after;
    expect(a?.role).toEqual(ROLE_REVIEW);
    expect(a?.approver_mode).toBeUndefined();
    expect(a?.group_id ?? null).toBeNull();
  });
  it("bước Ký = signer_role «Người ký hợp đồng», không còn «Ký qua»/người ký cố định", () => {
    const e = stages.find((x) => x.executor?.tool_key === "contracts-esign-send");
    expect(e?.executor?.args?.signer_role?.value).toBe(ROLE_SIGN.key);
    expect(ROLE_SIGN.label).toBe("Người ký hợp đồng");
    expect(e?.executor?.args?.provider).toBeUndefined();
    expect(e?.executor?.args?.company_signers).toBeUndefined();
  });
  it("withSignerRole chỉ đụng bước Ký", () => {
    expect(withSignerRole([{ executor: { tool_key: "x", args: {} } }])).toEqual([
      { executor: { tool_key: "x", args: {} } },
    ]);
  });
  it("quy trình phụ có vai CHƯA giao và điều kiện không bao giờ đúng", () => {
    const roles = (signFlow2Stages() as S[]).flatMap((x) => (x.after?.role ? [x.after.role] : []));
    expect(roles).toEqual([ROLE_SPARE]);
    expect(roleAssignPlan(new Map()).missing).toContain("binh.tran");
    expect(ROLE_SPARE.key).not.toBe(ROLE_REVIEW.key);
    expect(JSON.stringify(signFlow2Trigger().when)).toContain('"lt"');
  });
  it("chính ĐẦU, phụ CUỐI, không nhân đôi", () => {
    expect(signFlowOrder(["a", "m", "b", "p"], "m", "p")).toEqual(["m", "a", "b", "p"]);
    expect(signFlowOrder(["a", "b"], "m", "p")).toEqual(["m", "a", "b", "p"]);
  });
  it("giao việc: chỉ 2 vai của quy trình chính (không giao vai phụ); thiếu người ⇒ liệt kê", () => {
    const p = roleAssignPlan(
      new Map([
        ["binh.tran", "u1"],
        ["demo-owner", "u2"],
      ]),
    );
    expect(p.assign).toEqual([
      { role_key: ROLE_REVIEW.key, user_id: "u1" },
      { role_key: ROLE_SIGN.key, user_id: "u2" },
    ]);
    expect(p.assign.some((a) => a.role_key === ROLE_SPARE.key)).toBe(false);
    expect(roleAssignPlan(new Map([["binh.tran", "u1"]])).missing).toEqual(["demo-owner"]);
  });
});

describe("kế hoạch HĐ mẫu", () => {
  it("lần đầu tạo + 2 tệp; lần hai rỗng; đã rời Nháp rỗng", () => {
    expect(planSignSample({ exists: false, status: null, fileNames: [] })).toEqual([
      "create",
      "file_contract",
      "promote_main",
      "file_annex",
      "partner_contact",
    ]);
    expect(
      planSignSample({
        exists: true,
        status: "draft",
        fileNames: [CONTRACT_FILE, ANNEX_FILE],
        hasMain: true,
        hasPartnerContact: true,
      }),
    ).toEqual([]);
    expect(planSignSample({ exists: true, status: "processing", fileNames: [] })).toEqual([]);
  });
});

describe("PDF mẫu", () => {
  it("hợp đồng 6 trang, trang cuối có ĐẠI DIỆN BÊN A/B + (Ký, ghi rõ họ tên)", async () => {
    const p = await contractPdf();
    expect((await PDFDocument.load(p.bytes)).getPageCount()).toBe(6);
    const last = p.texts[5] ?? [];
    expect(last).toContain("ĐẠI DIỆN BÊN A");
    expect(last).toContain("ĐẠI DIỆN BÊN B");
    expect(last).toContain("(Ký, ghi rõ họ tên)");
    expect(p.texts.slice(0, 5).flat()).not.toContain("ĐẠI DIỆN BÊN A");
  });
  it("phụ lục 2 trang", async () => {
    const p = await annexPdf();
    expect((await PDFDocument.load(p.bytes)).getPageCount()).toBe(2);
  });
});

describe("fix-cr181-uat · lỗi 1a/3/5 · dữ liệu mẫu đủ cho kịch bản", () => {
  it("HĐ nháp đã có 2 tệp nhưng hợp đồng đang là tệp kèm, đối tác chưa có liên hệ ⇒ chỉ sửa hai chỗ đó", () => {
    expect(
      planSignSample({
        exists: true,
        status: "draft",
        fileNames: [CONTRACT_FILE, ANNEX_FILE],
        hasMain: false,
        hasPartnerContact: false,
      }),
    ).toEqual(["promote_main", "partner_contact"]);
  });
  it("giám đốc demo chưa thuộc nhóm người ký ⇒ thêm, có rồi ⇒ bỏ qua", () => {
    expect(signerNeedsAdd(["em.hoang"])).toBe(true);
    expect(signerNeedsAdd(["em.hoang", "demo-owner"])).toBe(false);
    expect(signPartnerKey()).toBe("tax:0100150002");
  });
});

describe("HĐ mẫu theo ngày + đời dữ liệu", () => {
  const now = new Date("2026-11-18T03:00:00Z");
  const today = dailySampleTarget(now);
  it("id/tiêu đề theo ngày VN, đời 17 ≠ đời 16 (HĐ lỗi cũ không bị dùng lại)", () => {
    expect(today.id).toBe("c1810000-0000-4000-8000-172611180000");
    expect(today.title).toBe("HĐ mẫu · Ký trên tài liệu (CR-181) · 18/11 · bản 2");
    expect(today.id.startsWith(SIGN_ID_PREFIX)).toBe(true);
    expect(dailySampleTarget(new Date("2026-11-18T17:30:00Z")).title).toContain("19/11");
  });
  it("chưa có ⇒ HĐ hôm nay; còn Nháp đời hiện tại ⇒ dùng nó; đã rời Nháp ⇒ HĐ hôm nay", () => {
    expect(pickSampleTarget([], now)).toEqual(today);
    const d = { id: `${SIGN_ID_PREFIX}2611170000`, status: "draft" };
    expect(pickSampleTarget([d], now).id).toBe(d.id);
    expect(pickSampleTarget([{ ...d, status: "processing" }], now)).toEqual(today);
    // HĐ đời 16 còn Nháp (fields sai) KHÔNG được dùng lại
    expect(
      pickSampleTarget([{ id: "c1810000-0000-4000-8000-162611180000", status: "draft" }], now),
    ).toEqual(today);
  });
  it("kế hoạch: HĐ chưa có ⇒ tạo đủ; Nháp fields sai ⇒ sửa fields; đã rời Nháp ⇒ rỗng (không tạo hai HĐ cùng ngày)", () => {
    expect(planSignSample({ exists: false, status: null, fileNames: [] })[0]).toBe("create");
    const draft = {
      exists: true,
      status: "draft",
      fileNames: [CONTRACT_FILE, ANNEX_FILE],
      hasMain: true,
      hasPartnerContact: true,
    };
    expect(planSignSample({ ...draft, hasFacts: false })).toEqual(["fix_fields"]);
    expect(planSignSample({ ...draft, hasFacts: true })).toEqual([]);
    expect(planSignSample({ ...draft, status: "processing", hasFacts: false })).toEqual([]);
  });
});

describe("fields của HĐ mẫu khớp điều kiện quy trình", () => {
  it("total_value.value là số ≤ ngưỡng, có đối tác bên mua (tax) ⇒ khớp when của quy trình ký trên tài liệu", () => {
    const f = signSampleFields("x");
    expect(typeof f.total_value.value).toBe("number");
    const le = (
      signFlowTrigger().when.conds as { fact: string; op: string; value: unknown }[]
    ).find((c) => c.fact === "total_value");
    expect(le?.op).toBe("le");
    expect(f.total_value.value).toBeLessThanOrEqual(le?.value as number);
    expect(f.buyer_tax_id.value).toBe(SIGN_PARTNER.tax);
    expect(signPartnerKey()).toBe(`tax:${SIGN_PARTNER.tax}`);
  });
  it("giám đốc demo chưa thuộc nhóm người ký ⇒ thêm, có rồi ⇒ bỏ qua", () => {
    expect(signerNeedsAdd(["em.hoang"])).toBe(true);
    expect(signerNeedsAdd(["em.hoang", "demo-owner"])).toBe(false);
  });
});
