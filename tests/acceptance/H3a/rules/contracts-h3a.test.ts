// HUB-BR-04 · H3a-R19 · spec §3 · `plan` P2: contract không đổi — `JOB_FAIL_REASONS` đã có reason H3a, schema `run.failed`
// nhận 4 cặp câu R08 (test-plan-cases H3a §1.3 R20–R21). Xanh trước code là đúng (P2: không đổi contract).
import { describe, expect, it } from "bun:test";
import { RunFailedDataSchema } from "@ai/contracts/chat";
import { JOB_FAIL_REASONS } from "@ai/contracts/hub";
import { R08 } from "../_r08";

describe("R20–R21 · contract giữ nguyên [H3a-R19 · HUB-H3a-AC-13]", () => {
  it("HUB-BR-04 · R20 · JOB_FAIL_REASONS chứa quota, provider_unavailable [H3a-R19 · P2]", () => {
    expect(JOB_FAIL_REASONS).toContain("quota");
    expect(JOB_FAIL_REASONS).toContain("provider_unavailable");
  });

  it("HUB-BR-04 · R21 · run.failed parse được với 4 cặp message/hint R08 (vi/en × quota/provider_unavailable) [H3a-R08 · H3a-R19]", () => {
    for (const reason of ["quota", "provider_unavailable"] as const)
      for (const locale of ["vi", "en"] as const) {
        const data = {
          run_id: "a3a00000-0000-4000-8000-000000000001",
          message_id: "a3a00000-0000-4000-8000-000000000002",
          code: "ALL_PROVIDERS_EXHAUSTED",
          ...R08[reason][locale],
        };
        expect(RunFailedDataSchema.safeParse(data).success).toBe(true);
      }
  });
});
