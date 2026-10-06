// HUB-FR-52 · HUB-FR-87 · H3b-R17, R18, R49 · HUB-H3b-AC-08…10 · test-plan-cases H3b §1.4 R40–R49: `traceAccess` (quyết
// nhánh trước scope system), `redactTraceDetail` (khoá/giá trị nhạy cảm, độ sâu, kích thước, view own/platform — PL15,
// PL16, G4, G5), `stepMs`.
import { describe, expect, it } from "bun:test";
import type { Role } from "@ai/contracts";
import { MASK } from "@ai/contracts/hub-admin";
import {
  redactTraceDetail,
  SENSITIVE_KEY_RE,
  SENSITIVE_VALUE_RE,
  stepMs,
  traceAccess,
} from "../../../../apps/hub-api/src/modules/runs/trace/trace.rules";

const odd = (r: string) => r as unknown as Role;
const SENS_KEYS = [
  "api_key",
  "apiKey",
  "client_secret",
  "access_token",
  "password",
  "passwd",
  "Authorization",
  "Cookie",
  "credentials",
  "private_key",
  "token",
  "token_hash",
  "tokenBudget",
];
const SENS_VALUES = [
  "Bearer abc.def",
  `app-${"A1b2C3d4E5f6G7h8"}`,
  `sk-${"abcdEFGH1234_-xy"}`,
  "-----BEGIN RSA PRIVATE KEY-----\nMIIBOg\n-----END RSA PRIVATE KEY-----",
];
const TOKENS = { input_tokens: 5, output_tokens: 7, extra_tokens: 3, max_tokens: 100 };
/** `hops` lần lồng object tới lá: gốc = mức 1 ⇒ lá ở mức `hops + 1` (G5, PL15). */
const chain = (hops: number, leaf: unknown): Record<string, unknown> => ({
  n: hops <= 1 ? leaf : chain(hops - 1, leaf),
});

describe("traceAccess [HUB-FR-52 · HUB-FR-87 · H3b-R17]", () => {
  it("HUB-FR-52 · R40 · ownRun = true × 3 role ⇒ own (kể cả platform_admin — Q-U4, không audit) [H3b-R17 · HUB-H3b-AC-08]", () => {
    for (const role of ["member", "tenant_admin", "platform_admin"] as Role[])
      expect(traceAccess({ role }, true)).toBe("own");
  });

  it("HUB-FR-87 · R41 · ownRun = false: platform_admin ⇒ platform; tenant_admin, member, owner ⇒ not_found (Q-U2) [H3b-R17 · HUB-H3b-AC-09, AC-10]", () => {
    expect(traceAccess({ role: "platform_admin" }, false)).toBe("platform");
    expect(traceAccess({ role: "tenant_admin" }, false)).toBe("not_found");
    expect(traceAccess({ role: "member" }, false)).toBe("not_found");
    expect(traceAccess({ role: odd("owner") }, false)).toBe("not_found");
  });
});

describe("redactTraceDetail [HUB-FR-52 · H3b-R18 · HUB-H3b-AC-10]", () => {
  it("HUB-FR-52 · R42 · hằng: SENSITIVE_KEY_RE khớp 13 khoá nhạy cảm, không khớp *_tokens; SENSITIVE_VALUE_RE khớp 4 dạng (B0 có sẵn) [H3b-R18 · PL16 · G4]", () => {
    for (const k of SENS_KEYS)
      expect({ k, hit: SENSITIVE_KEY_RE.test(k) }).toEqual({ k, hit: true });
    for (const k of Object.keys(TOKENS))
      expect({ k, hit: SENSITIVE_KEY_RE.test(k) }).toEqual({ k, hit: false });
    for (const v of SENS_VALUES)
      expect({ v, hit: SENSITIVE_VALUE_RE.test(v) }).toEqual({ v, hit: true });
    for (const v of ["app-short", "bearer", "x", "haiku"])
      expect({ v, hit: SENSITIVE_VALUE_RE.test(v) }).toEqual({ v, hit: false });
  });

  it("HUB-FR-52 · R42 · khoá nhạy cảm (api_key … tokenBudget) ⇒ giá trị MASK, khoá giữ nguyên [H3b-R18 · PL16]", () => {
    for (const k of SENS_KEYS)
      expect(redactTraceDetail({ [k]: "giá-trị-thường", ok: 1 }, "platform")).toEqual({
        [k]: MASK,
        ok: 1,
      });
  });

  it("HUB-FR-52 · R43 · giá trị dạng token (Bearer, app-, sk-, PRIVATE KEY) ở mọi mức + trong mảng ⇒ MASK [H3b-R18]", () => {
    for (const v of SENS_VALUES) {
      const d = { a: v, b: { c: v, d: [v, { e: v }] }, keep: "ok" };
      expect(redactTraceDetail(d, "platform")).toEqual({
        a: MASK,
        b: { c: MASK, d: [MASK, { e: MASK }] },
        keep: "ok",
      });
    }
  });

  it("HUB-FR-52 · R44 · không nhạy cảm (label, model, app-short, bearer) + *_tokens số ⇒ giữ nguyên deep-equal [H3b-R18 · G4]", () => {
    const plain = { label: "x", model: "haiku", note: "app-short", word: "bearer" };
    expect(redactTraceDetail(plain, "platform")).toEqual(plain);
    expect(redactTraceDetail({ ...TOKENS }, "platform")).toEqual(TOKENS);
    expect(redactTraceDetail({ usage: { ...TOKENS } }, "own")).toEqual({ usage: TOKENS });
  });

  it("HUB-FR-52 · R45 · độ sâu (G5): lá mức 6 giữ · lá mức 7 ⇒ MASK [H3b-R18 · PL15]", () => {
    expect(redactTraceDetail(chain(5, "x"), "platform")).toEqual(chain(5, "x"));
    expect(redactTraceDetail(chain(6, "x"), "platform")).toEqual(chain(6, MASK));
  });

  it("HUB-FR-52 · R46 · kích thước (G5): JSON sau che 16 384 byte giữ · 16 385 byte ⇒ {truncated:true} [H3b-R18 · PL15]", () => {
    const pad = (n: number) => ({ pad: "a".repeat(n - 10) });
    expect(Buffer.byteLength(JSON.stringify(pad(16_384)))).toBe(16_384);
    expect(redactTraceDetail(pad(16_384), "platform")).toEqual(pad(16_384));
    expect(redactTraceDetail(pad(16_385), "platform")).toEqual({ truncated: true });
    // đo SAU khi che: khoá nhạy cảm dài bị thay MASK ⇒ nhỏ lại, không truncated
    const big = { token: "a".repeat(20_000), ok: 1 };
    expect(redactTraceDetail(big, "platform")).toEqual({ token: MASK, ok: 1 });
  });

  it('HUB-FR-52 · R47 · null/undefined/42/"s" ⇒ null; mảng gốc ⇒ {items:[…đã che]}; input không bị sửa [H3b-R18]', () => {
    for (const v of [null, undefined, 42, "s"]) expect(redactTraceDetail(v, "platform")).toBeNull();
    expect(redactTraceDetail([{ token: "x" }], "platform")).toEqual({ items: [{ token: MASK }] });
    const d = { api_key: "k", nested: { password: "p" }, list: ["Bearer abc.def"] };
    const before = structuredClone(d);
    redactTraceDetail(d, "own");
    redactTraceDetail(d, "platform");
    expect(d).toEqual(before);
  });

  it("HUB-FR-52 · R49 · view own bỏ khoá gốc message/upstream, giữ usage/code; platform giữ nguyên; khoá lồng mức 2 không bị bỏ; input không sửa [H3b-R49 · PL15 · H1-R26]", () => {
    const d = { message: "M", upstream: "U", usage: { input_tokens: 5 }, code: "x" };
    const before = structuredClone(d);
    expect(redactTraceDetail(d, "own")).toEqual({ usage: { input_tokens: 5 }, code: "x" });
    expect(redactTraceDetail(d, "platform")).toEqual(before);
    const nested = { inner: { message: "M2", upstream: "U2" } };
    expect(redactTraceDetail(nested, "own")).toEqual(nested);
    expect(d).toEqual(before);
  });
});

describe("stepMs [HUB-FR-52 · H3b-R18]", () => {
  it("HUB-FR-52 · R48 · (t, null) ⇒ null · (t, t) ⇒ 0 · (t, t+1234) ⇒ 1234 · (t, t−5) ⇒ 0 [H3b-R18]", () => {
    const t = new Date("2026-10-06T08:00:00.000Z");
    const at = (ms: number) => new Date(t.getTime() + ms);
    expect(stepMs(t, null)).toBeNull();
    expect(stepMs(t, at(0))).toBe(0);
    expect(stepMs(t, at(1234))).toBe(1234);
    expect(stepMs(t, at(-5))).toBe(0);
  });
});
