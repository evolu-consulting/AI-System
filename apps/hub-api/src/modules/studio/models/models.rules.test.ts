// HUB-FR-66 · HUB-FR-67 · plan H4b2 §2.1 — biên luật thuần Models ngoài ca qc (R01–R24).
import { describe, expect, test } from "bun:test";
import {
  baseUrlProblem,
  providerChanged,
  providerShapeProblem,
  stepsProblem,
} from "./models.rules";

const PROD = { dev: false };
describe("HUB-FR-66 · baseUrlProblem biên", () => {
  test("giao thức khác http(s) ⇒ invalid; dấu ? hoặc # rỗng ⇒ invalid", () => {
    for (const u of [
      "ftp://x.example.test",
      "javascript:alert(1)",
      "https://x.test/?",
      "https://x.test/#",
    ])
      expect([u, baseUrlProblem(u, PROD)]).toEqual([u, "invalid"]);
  });
  test("api + subscription: lỗi secret trước base_url", () => {
    expect(
      providerShapeProblem({ kind: "api", base_url: "ftp://x", secret_id: null }, PROD),
    ).toEqual({
      path: "secret_id",
      reason: "required",
    });
  });
});

describe("HUB-FR-67 · stepsProblem biên", () => {
  test("cùng provider: model null và model 'a' khác nhau ⇒ hợp lệ; null trùng null ⇒ duplicate", () => {
    const p = new Map([["a", { vendor: "fake" }]]);
    const s = (model: string | null) => ({ provider_key: "a", model, on: [] });
    expect(stepsProblem([s(null), s("a")], p)).toBeNull();
    expect(stepsProblem([s(null), s(null)], p)).toEqual({ index: 1, reason: "duplicate" });
  });
  test("providerChanged: null → null không tính là đổi", () => {
    const b = { base_url: null, secret_id: null, max_concurrency: 1, enabled: true };
    expect(providerChanged(b, { ...b })).toEqual([]);
  });
});
