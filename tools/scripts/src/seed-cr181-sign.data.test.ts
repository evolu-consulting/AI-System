import { describe, expect, it } from "bun:test";
import { createRequire } from "node:module";
import { SignatureSettingsSchema } from "../../../packages/contracts/src/signature";
import {
  ANNEX_FILE,
  annexPdf,
  CONTRACT_FILE,
  contractPdf,
  planSignSample,
  signFlowOrder,
  signFlowStages,
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
      "file_annex",
    ]);
    expect(
      planSignSample({ exists: true, status: "draft", fileNames: [CONTRACT_FILE, ANNEX_FILE] }),
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
