// ADM-FR-50, ADM-BR-04 · luật thuần secrets (plan.md §4 `secrets.rules.ts`; M2-R02, M2-R05).
import { describe, expect, it } from "bun:test";
import { LEAK_1, LEAK_EMOJI } from "../_data";
import { loadSecretsRules } from "../_modules";

describe("ADM-FR-50 · secrets.rules", () => {
  it("ADM-FR-50 · M2-R02 · secretLast4: 4 ký tự cuối của giá trị thường", async () => {
    const r = await loadSecretsRules();
    expect(r.secretLast4(`${LEAK_1.slice(0, -4)}a91d`)).toBe("a91d");
    expect(r.secretLast4("12345678")).toBe("5678");
    expect(r.secretLast4("abcdefgh")).toHaveLength(4);
  });

  it("ADM-FR-50 · M2-R02 · secretLast4: theo code point, không cắt cặp thay thế (emoji)", async () => {
    const r = await loadSecretsRules();
    expect(r.secretLast4(LEAK_EMOJI)).toBe(LEAK_EMOJI);
    expect(Array.from(r.secretLast4(`abc${LEAK_EMOJI}`))).toHaveLength(4);
    expect(r.secretLast4("xx😀y😀z")).toBe("😀y😀z");
  });

  it("ADM-FR-50 · M2-R02 · secretLast4: ký tự tổ hợp đếm theo code point", async () => {
    const r = await loadSecretsRules();
    expect(r.secretLast4("abcdefǵ")).toBe("efǵ");
    expect(Array.from(r.secretLast4("abcdefǵ"))).toHaveLength(4);
  });

  it("ADM-FR-50 · M2-R05 · checkSecretDelete: không dùng → null", async () => {
    const r = await loadSecretsRules();
    expect(r.checkSecretDelete([])).toBeNull();
  });

  it("ADM-FR-50 · M2-R05 · checkSecretDelete: đang dùng → SECRET_IN_USE {used_by} giữ thứ tự", async () => {
    const r = await loadSecretsRules();
    expect(r.checkSecretDelete(["summarize", "translate"])).toEqual({
      code: "SECRET_IN_USE",
      details: { used_by: ["summarize", "translate"] },
    });
  });
});
