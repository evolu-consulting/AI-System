// COM-C11a: unit map kết quả model + dựng bản nháp đăng lại.
import { describe, expect, test } from "bun:test";
import { mapModelOutput } from "./image-check.rules";
import { buildRepostDraft } from "./repost.rules";

const out = (o: unknown): string => JSON.stringify(o);

describe("mapModelOutput", () => {
  test("không thấy gì ⇒ clean", () => {
    expect(mapModelOutput(out({ text: "Gạch men 60x60", logos: [], companies: [] }))).toEqual({
      status: "clean",
      findings: [],
    });
  });
  test("SĐT + email trong chữ OCR ⇒ suspect, confidence 1 (xác định)", () => {
    const r = mapModelOutput(out({ text: "LH 0912 345 678 abc@x.com", logos: [], companies: [] }));
    expect(r.status).toBe("suspect");
    expect(r.findings.map((f) => f.kind).sort()).toEqual(["email", "phone"]);
    expect(r.findings.every((f) => f.confidence === 1)).toBe(true);
  });
  test("tên công ty khác trong ctx khớp ở chữ OCR", () => {
    const r = mapModelOutput(out({ text: "Hàng của ACME Gốm", logos: [], companies: [] }), {
      otherCompanies: ["Acme Gom"],
    });
    expect(r.findings[0]?.kind).toBe("company_name");
  });
  test("logo/tên do model: qua ngưỡng mới tính", () => {
    const r = mapModelOutput(
      out({
        text: "",
        logos: [
          { description: "logo xanh", confidence: 0.9 },
          { description: "mờ", confidence: 0.2 },
        ],
        companies: [
          { name: "Foo Co", confidence: 0.7 },
          { name: "Bar", confidence: 0.1 },
        ],
      }),
    );
    expect(r.findings.map((f) => f.kind)).toEqual(["logo", "company_name"]);
    expect(r.status).toBe("suspect");
  });
  test("đầu ra hỏng / thiếu text ⇒ unknown; chịu rào ```json", () => {
    expect(mapModelOutput("không phải json").status).toBe("unknown");
    expect(mapModelOutput(out({ logos: [] })).status).toBe("unknown");
    expect(
      mapModelOutput(`\`\`\`json\n${out({ text: "", logos: [], companies: [] })}\n\`\`\``).status,
    ).toBe("clean");
  });
});

describe("buildRepostDraft", () => {
  const src = {
    product: "Gạch men 60x60",
    quantity: 500,
    body: "Gạch men loại 1, giao nhanh. SĐT: 0912 345 678, zalo.me/abc. Công ty Acme Gom bảo hành.",
    images: [
      { ref: "a", leakStatus: "clean" as const },
      { ref: "b", leakStatus: "suspect" as const },
      { ref: "c", leakStatus: "unknown" as const },
    ],
  };
  const d = buildRepostDraft(src, { otherCompanies: ["Acme Gom"] });
  test("bỏ SĐT/link/tên công ty khác, giá để trống, không người đăng", () => {
    expect(d.body).not.toMatch(/0912|zalo|Acme/i);
    expect(d.body).toContain("Gạch men loại 1");
    expect(d.price).toBeNull();
    expect(d.quantity).toBe(500);
    expect(Object.keys(d)).not.toContain("author");
  });
  test("ảnh suspect loại mặc định, clean/unknown giữ", () => {
    expect(d.images.map((i) => i.included)).toEqual([true, false, true]);
    expect(d.hasSuspectImages).toBe(true);
  });
});
