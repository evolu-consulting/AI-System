// CR-135 Q4 · cổng tải lên theo cờ ký số: công ty đang ký số ⇒ tệp chính không phải PDF bị chặn TRƯỚC quota/FileBox/HĐ (422 ESIGN_NEEDS_PDF);
// công ty không ký số (hoặc không có cờ) ⇒ docx/văn bản đi tiếp; PDF luôn qua cổng này; tệp dựng sẵn từ phiếu (`prefill`) không qua cổng.
import { describe, expect, it } from "bun:test";
import { esignRequiresPdf } from "@ai/contracts/pack-contracts";
import { UploadError } from "./upload-contract.ports";
import { createUploadContract, type UploadContractDeps } from "./upload-contract.usecase";

const who = { tenantId: "t1", userId: "u1" };
const enc = (s: string) => new TextEncoder().encode(s);
const PDF = enc("%PDF-1.4\n1 0 obj<<>>endobj\n%%EOF");
const TEXT = enc("Hợp đồng thuê kho — văn bản thuần");

/** Mọi cổng sau `precheck` ném `UPLOAD_QUOTA_UNAVAILABLE` ⇒ test phân biệt "qua cổng ký số" (UPLOAD_QUOTA_UNAVAILABLE) với "bị chặn" (UploadError ESIGN_NEEDS_PDF). */
const deps = (esignOn?: boolean): UploadContractDeps =>
  ({
    counter: {
      take: async () => {
        throw new Error("redis");
      },
    },
    zipNames: () => [],
    limits: { tenant: 1, global: 1 },
    ...(esignOn === undefined ? {} : { esignOn: async () => esignOn }),
  }) as unknown as UploadContractDeps;

const input = (bytes: Uint8Array, name: string, extra: object = {}) => ({
  who,
  timeZone: "UTC",
  bytes,
  name,
  title: "t",
  kind: "contract" as const,
  parentId: null,
  ...extra,
});
const outcome = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: unknown) => (e instanceof UploadError ? e.code : e instanceof Error ? e.message : "?"),
  );

describe("esignRequiresPdf", () => {
  it("chỉ khi bật VÀ có nhà cung cấp", () => {
    expect(esignRequiresPdf({ enabled: true, configured: true })).toBe(true);
    expect(esignRequiresPdf({ enabled: true, configured: false })).toBe(false);
    expect(esignRequiresPdf({ enabled: false, configured: true })).toBe(false);
  });
});

describe("cổng ký số của tải lên", () => {
  it("ký số bật + tệp không phải PDF ⇒ ESIGN_NEEDS_PDF", async () => {
    expect(await outcome(createUploadContract(deps(true))(input(TEXT, "hd.txt")))).toBe(
      "ESIGN_NEEDS_PDF",
    );
  });
  it("ký số bật + PDF ⇒ qua cổng (dừng ở bước quota)", async () => {
    expect(await outcome(createUploadContract(deps(true))(input(PDF, "hd.pdf")))).toBe(
      "UPLOAD_QUOTA_UNAVAILABLE",
    );
  });
  it("ký số tắt hoặc không có cờ ⇒ tệp không phải PDF qua cổng", async () => {
    expect(await outcome(createUploadContract(deps(false))(input(TEXT, "hd.txt")))).toBe(
      "UPLOAD_QUOTA_UNAVAILABLE",
    );
    expect(await outcome(createUploadContract(deps())(input(TEXT, "hd.txt")))).toBe(
      "UPLOAD_QUOTA_UNAVAILABLE",
    );
  });
  it("tệp dựng sẵn từ phiếu (prefill) không bị chặn", async () => {
    const i = input(TEXT, "hd.txt", { prefill: { fields: {} } });
    expect(await outcome(createUploadContract(deps(true))(i))).toBe("UPLOAD_QUOTA_UNAVAILABLE");
  });
});
