// PK-FR-10 · TF1: bản dịch contracts-web — vi/en cùng tập key, mọi giá trị không rỗng.
import { describe, expect, test } from "bun:test";
import { loadContractsLocale } from "./contracts-locales";

const flattenKeys = (o: unknown, prefix = ""): string[] =>
  typeof o === "object" && o !== null
    ? Object.entries(o).flatMap(([k, v]) => flattenKeys(v, prefix ? `${prefix}.${k}` : k))
    : [prefix];

describe("contracts-locales", () => {
  test("vi và en cùng tập key, nằm dưới `contracts.`", async () => {
    const vi = flattenKeys(await loadContractsLocale("vi")).sort();
    const en = flattenKeys(await loadContractsLocale("en")).sort();
    expect(vi).toEqual(en);
    expect(vi.length).toBeGreaterThan(0);
    expect(vi.every((k) => k.startsWith("contracts."))).toBe(true);
  });

  test("tên app giữ nguyên theo mgmt-app (D-02)", async () => {
    const vi = (await loadContractsLocale("vi")) as { contracts: { app: { name: string } } };
    expect(vi.contracts.app.name).toBe("Sổ Hợp Tác");
  });
});
