// CR-152 · luật thuần của seed HĐ mẫu Nhượng quyền / Hợp tác: kind_terms đúng schema + đủ trường, ngày, kế hoạch idempotent, guard stg-test.
import { describe, expect, it } from "bun:test";
import {
  CooperationTermsSchema,
  FranchiseTermsSchema,
  kindTermsMissing,
} from "../../../packages/contracts/src/pack-contracts/kind-terms";
import {
  KIND_SAMPLES,
  type KindSample,
  kindSamplesGuard,
  planSample,
  type SampleState,
  sampleDates,
  sampleFields,
  sampleId,
} from "./seed-kind-samples.data";

const [fr, co] = KIND_SAMPLES as [KindSample, KindSample];
const none: SampleState = {
  exists: false,
  status: null,
  hasKindTerms: false,
  hasFile: false,
  hasRun: false,
};

describe("kind_terms mẫu", () => {
  it("đúng schema, đủ trường bắt buộc", () => {
    expect(FranchiseTermsSchema.safeParse(fr.terms).success).toBe(true);
    expect(CooperationTermsSchema.safeParse(co.terms).success).toBe(true);
    expect(kindTermsMissing("franchise", fr.terms as Record<string, unknown>)).toEqual([]);
    expect(kindTermsMissing("cooperation", co.terms as Record<string, unknown>)).toEqual([]);
  });
  it("Nhượng quyền: mình là bên nhượng quyền, 300 triệu + 5% hằng tháng; Hợp tác: 60% lợi nhuận, quý", () => {
    expect(fr.terms).toMatchObject({
      role: "franchisor",
      initial_fee: 300_000_000,
      fee_basis: "revenue_pct",
      fee_pct: 5,
      period: "month",
    });
    expect(fr.direction).toBe("sale");
    expect(co.terms).toMatchObject({
      split_basis: "profit",
      our_share_pct: 60,
      settle_period: "quarter",
    });
  });
  it("người tạo hai HĐ khác nhau; id cố định khác nhau", () => {
    expect(fr.by).not.toBe(co.by);
    expect(sampleId(1)).not.toBe(sampleId(2));
  });
});

describe("ngày hiệu lực", () => {
  it("3 năm từ ngày 1 tháng sau", () => {
    expect(sampleDates(new Date("2026-11-14T05:00:00Z"))).toEqual({
      start: "2026-12-01",
      end: "2029-11-30",
      signed: "2026-11-14",
    });
    expect(sampleDates(new Date("2026-12-20T00:00:00Z")).start).toBe("2027-01-01");
  });
  it("trường HĐ có đối tác trong sổ + hiệu lực", () => {
    const f = sampleFields(fr, new Date("2026-11-14T00:00:00Z"));
    expect(f).toMatchObject({
      buyer_tax_id: "0100150002",
      start_date: "2026-12-01",
      total_value: 300_000_000,
    });
    expect(sampleFields(co, new Date("2026-11-14T00:00:00Z")).total_value).toBeUndefined();
  });
});

describe("kế hoạch idempotent", () => {
  it("chưa có ⇒ tạo đủ bước; Nhượng quyền thêm duyệt+ký, Hợp tác dừng ở chờ duyệt", () => {
    expect(planSample(fr, none)).toEqual(["create", "kind_terms", "file", "review", "approve_all"]);
    expect(planSample(co, none)).toEqual(["create", "kind_terms", "file", "review"]);
  });
  it("nháp đã đủ dữ liệu ⇒ chỉ lưu + gửi", () => {
    const st: SampleState = {
      ...none,
      exists: true,
      status: "draft",
      hasKindTerms: true,
      hasFile: true,
    };
    expect(planSample(co, st)).toEqual(["review"]);
  });
  it("đang duyệt: Nhượng quyền duyệt tiếp, Hợp tác giữ nguyên (không gửi lại)", () => {
    const st: SampleState = {
      exists: true,
      status: "processing",
      hasKindTerms: true,
      hasFile: true,
      hasRun: true,
    };
    expect(planSample(fr, st)).toEqual(["approve_all"]);
    expect(planSample(co, st)).toEqual([]);
  });
  it("đã DONE hoặc bị từ chối ⇒ không làm gì (chạy lại không đôi)", () => {
    for (const status of ["done", "reject"] as const)
      for (const s of KIND_SAMPLES)
        expect(planSample(s, { ...none, exists: true, status })).toEqual([]);
  });
});

describe("guard", () => {
  it("từ chối ngoài stg-test và production", () => {
    expect(kindSamplesGuard({}, "postgres://u@pg:5432/x")).not.toBeNull();
    expect(
      kindSamplesGuard(
        {
          S2_STACK: "stg-test",
          S2_PUBLIC_ADMIN_URL: "https://ai-test-admin.example.com",
          APP_ENV: "production",
        },
        "postgres://u@pg:5432/x",
      ),
    ).not.toBeNull();
  });
});
