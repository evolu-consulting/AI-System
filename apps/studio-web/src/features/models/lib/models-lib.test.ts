// HUB-FR-66 · unit: validate form Provider, phân loại lỗi lưu, cooldown.
import { describe, expect, test } from "bun:test";
import type { ProviderItem } from "../api";
import { classifySaveError } from "./save-error";
import { providerFormSchema } from "./schema";
import { cooldownMinutes, needsGuide } from "./status";

const base = {
  key: "openai-backup",
  kind: "api" as const,
  vendor: "openai",
  base_url: "",
  secret_id: "s1",
  max_concurrency: "1",
  enabled: true,
};
const paths = (v: object, mode: "create" | "edit" = "create") => {
  const r = providerFormSchema(mode).safeParse(v);
  return r.success ? [] : r.error.issues.map((i) => String(i.path[0]));
};

describe("providerFormSchema", () => {
  test("hợp lệ", () => expect(paths(base)).toEqual([]));
  test("khoá sai, thiếu API key, slot 0", () => {
    expect(paths({ ...base, key: "A", secret_id: "", max_concurrency: "0" })).toEqual([
      "key",
      "secret_id",
      "max_concurrency",
    ]);
  });
  test("subscription không cần secret; sửa không kiểm khoá/hãng", () => {
    expect(paths({ ...base, kind: "subscription", secret_id: "" })).toEqual([]);
    expect(paths({ ...base, key: "", vendor: "" }, "edit")).toEqual([]);
  });
  test("Base URL phải http(s)", () =>
    expect(paths({ ...base, base_url: "ftp://x" })).toEqual(["base_url"]));
});

describe("classifySaveError", () => {
  test("KEY_TAKEN gắn ô khoá", () =>
    expect(classifySaveError({ code: "KEY_TAKEN" }).field).toBe("key"));
  test("PROVIDER_HAS_HISTORY là toast", () =>
    expect(classifySaveError({ code: "PROVIDER_HAS_HISTORY" }).toast?.key).toBe(
      "models.errors.providerHasHistory",
    ));
});

describe("status", () => {
  const p = (state: ProviderItem["state"], kind = "subscription") =>
    ({ kind, state }) as ProviderItem;
  test("cooldown phút", () => {
    const now = Date.parse("2026-10-13T08:00:00Z");
    const until = new Date(now + 42 * 60_000 + 20_000).toISOString();
    expect(
      cooldownMinutes(p({ status: "cooldown", cooldown_until: until, utilization: null }), now),
    ).toBe(42);
    expect(cooldownMinutes(p(null), now)).toBeNull();
  });
  test("Hướng dẫn chỉ cho subscription hết phiên/lỗi", () => {
    expect(needsGuide(p({ status: "logged_out", cooldown_until: null, utilization: null }))).toBe(
      true,
    );
    expect(needsGuide(p({ status: "ok", cooldown_until: null, utilization: null }))).toBe(false);
    expect(needsGuide(p({ status: "error", cooldown_until: null, utilization: null }, "api"))).toBe(
      false,
    );
  });
});
