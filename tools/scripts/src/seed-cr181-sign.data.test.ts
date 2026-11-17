import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { SignatureSettingsSchema } from "../../../packages/contracts/src/signature";
import {
  ANNEX_FILE,
  annexPdf,
  baseSampleTarget,
  CONTRACT_FILE,
  contractPdf,
  dailySampleTarget,
  pickSampleTarget,
  planSignSample,
  SIGN_CONTRACT_ID,
  signerNeedsAdd,
  signFlowOrder,
  signFlowStages,
  signPartnerKey,
  signSeedGuard,
  signSettingsBody,
  signSettingsNeeded,
  withOnDocSigner,
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

describe("quy trình", () => {
  it("bước Ký dùng ondoc + nhóm người ký", () => {
    type S = { executor?: { tool_key?: string; args?: Record<string, { value: string }> } };
    const s = withOnDocSigner(signFlowStages(), "gid") as S[];
    const e = s.find((x) => x.executor?.tool_key === "contracts-esign-send");
    expect(e?.executor?.args?.provider?.value).toBe("ondoc");
    expect(e?.executor?.args?.company_signers?.value).toBe("group:gid");
  });
  it("lên đầu thứ tự, không nhân đôi", () => {
    expect(signFlowOrder(["a", "m", "b"], "m")).toEqual(["m", "a", "b"]);
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

describe("fix-cr181-seed2 · HĐ mẫu mới khi HĐ cũ đã rời Nháp", () => {
  const now = new Date("2026-11-18T03:00:00Z");
  const today = dailySampleTarget(now);
  it("id/tiêu đề theo ngày VN", () => {
    expect(today.title).toBe("HĐ mẫu · Ký trên tài liệu (CR-181) · 18/11");
    expect(today.id).toBe("c1810000-0000-4000-8000-16261118" + "0000");
    // 17:30 UTC = 00:30 hôm sau ở VN
    expect(dailySampleTarget(new Date("2026-11-18T17:30:00Z")).title.endsWith("19/11")).toBe(true);
  });
  it("chưa có ⇒ HĐ gốc; còn Nháp ⇒ dùng nó; mọi HĐ đã rời Nháp ⇒ HĐ hôm nay", () => {
    expect(pickSampleTarget([], now)).toEqual(baseSampleTarget());
    expect(pickSampleTarget([{ id: SIGN_CONTRACT_ID, status: "draft" }], now).id).toBe(
      SIGN_CONTRACT_ID,
    );
    expect(pickSampleTarget([{ id: SIGN_CONTRACT_ID, status: "processing" }], now)).toEqual(today);
  });
  it("kế hoạch: HĐ hôm nay chưa có ⇒ tạo mới đủ bước; chạy lại cùng ngày ⇒ không tạo hai HĐ", () => {
    const rows = [{ id: SIGN_CONTRACT_ID, status: "done" }];
    expect(pickSampleTarget(rows, now).id).toBe(today.id);
    expect(planSignSample({ exists: false, status: null, fileNames: [] })[0]).toBe("create");
    // lần hai: HĐ hôm nay có và còn Nháp ⇒ chính nó; đã rời Nháp ⇒ chính nó + kế hoạch rỗng
    const again = [...rows, { id: today.id, status: "draft" }];
    expect(pickSampleTarget(again, now).id).toBe(today.id);
    const moved = [...rows, { id: today.id, status: "processing" }];
    expect(pickSampleTarget(moved, now).id).toBe(today.id);
    expect(planSignSample({ exists: true, status: "processing", fileNames: [] })).toEqual([]);
  });
});
