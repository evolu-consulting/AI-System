// CR-110 · COM-FR-45 · COM-FR-43 · unit cho mapper brand + caps.
import { describe, expect, it } from "bun:test";
import { CommunityBrandSchema } from "@ai/contracts/community";

const ACC = ["indigo", "blue", "teal", "green", "orange", "rose"] as const;

import { toCommunityBrand, viewerCaps } from "./brand.rules";

describe("toCommunityBrand [COM-FR-45]", () => {
  it("chép đúng 4 trường, bỏ mọi trường khác", () => {
    const row = {
      name: "Cty",
      appName: "App",
      logo: "data:image/png;base64,AA==",
      accent: "rose" as const,
    };
    const b = toCommunityBrand(
      { ...row, own_tax_ids: ["0101234567"] } as never,
      "Tenant",
      ACC,
      "indigo",
    );
    expect(b).toEqual(row);
    expect(CommunityBrandSchema.parse(b)).toEqual(row);
  });

  it("chưa có brand ⇒ tên tenant + indigo, logo/app null (P5-AC07)", () => {
    expect(toCommunityBrand(null, "Tenant X", ACC, "indigo")).toEqual({
      name: "Tenant X",
      appName: null,
      logo: null,
      accent: "indigo",
    });
  });

  it("tên rỗng ⇒ tên tenant; màu lạ ⇒ indigo; chuỗi trắng ⇒ null", () => {
    const b = toCommunityBrand(
      { name: " ", appName: "", logo: null, accent: "purple" },
      "T",
      ACC,
      "indigo",
    );
    expect(b).toEqual({ name: "T", appName: null, logo: null, accent: "indigo" });
  });
});

describe("viewerCaps [COM-FR-43]", () => {
  it("chủ quản có quyền contracts ⇒ true + url", () => {
    expect(viewerCaps(false, true, "https://sht")).toEqual({
      caps: { contracts: true },
      contractsUrl: "https://sht",
    });
  });
  it("chủ quản không quyền ⇒ false + null", () => {
    expect(viewerCaps(false, false, "/")).toEqual({
      caps: { contracts: false },
      contractsUrl: null,
    });
  });
  it("đối tác luôn false + null, kể cả khi cổng trả true", () => {
    expect(viewerCaps(true, true, "/")).toEqual({ caps: { contracts: false }, contractsUrl: null });
  });
});
