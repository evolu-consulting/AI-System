// HD1 review vòng 1 (m-02, m-06, m-07, m-10, m-11): route đọc/PATCH trên cổng giả (không DB) — PATCH thân quá trần ⇒ 413
// trước use case; `/source` có `nosniff` + `no-store`; `\u0000` ⇒ 422/400 (không lọt tới SQL); tên tệp bỏ C1/bidi, cắt theo
// điểm mã; `UPLOAD_MIME` khớp `CONTRACT_FILE_MIME`.
import { describe, expect, test } from "bun:test";
import {
  CONTRACT_FILE_MIME,
  ContractListQuerySchema,
  packFeatureKey,
  UploadContractFormSchema,
} from "@ai/contracts";
import { Hono } from "hono";
import { mapError } from "../../../../lib/errors";
import type { PackAccessView, PackGuardVars } from "../../kit/adapters/pack-guard.middleware";
import { UPLOAD_MIME } from "../application/upload-contract.usecase";
import { contractsMaxBytes } from "../upload.mount";
import {
  CONTRACTS_KEY,
  type ContractsReadUseCases,
  contractsRoutes,
  PATCH_BODY_MAX_BYTES,
} from "./contracts.routes";
import { cleanFileName, cutCodePoints, defaultTitle } from "./upload.routes";

const T = "00000000-0000-4000-8000-0000000000a1";
const ID = "00000000-0000-7000-8000-000000000001";
const FEATS = (["read", "write"] as const).map((a) => ({
  id: `f-${a}`,
  key: packFeatureKey(CONTRACTS_KEY, a),
  status: "on",
}));
const view: PackAccessView = {
  catalog: async () => ({
    features: FEATS,
    entitled: new Set(FEATS.map((f) => `${T}:${f.id}`)),
    grantGroups: new Map(FEATS.map((f) => [`${T}:${f.id}`, ["g"]])),
  }),
  user: async () => ({ tenantId: T, groupIds: new Set(["g"]) }),
};

function app(calls: string[]) {
  const uc = {
    source: async () => "# Điều 1 <script>",
    patchFields: async () => {
      calls.push("patch");
      return { kind: "not_found" };
    },
  } as unknown as ContractsReadUseCases;
  const a = new Hono<PackGuardVars>();
  a.use("*", async (c, next) => {
    c.set("user", { userId: "u1", tenantId: T, role: "member" });
    await next();
  });
  a.route("/", contractsRoutes(view, uc));
  a.onError((e, c) => {
    const m = mapError(e);
    return c.json(m.body, m.status);
  });
  return a;
}
/** Không có surrogate lẻ (`encodeURIComponent` ném URIError khi có). */
const wellFormed = (s: string) => {
  try {
    encodeURIComponent(s);
    return true;
  } catch {
    return false;
  }
};
const codeOf = async (r: Response) => ((await r.json()) as { error: { code: string } }).error.code;
const patch = (a: Hono<PackGuardVars>, body: string) =>
  a.request(`/contracts/${ID}/fields`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body,
  });

describe("HD1 review · route", () => {
  test("m-02 · PATCH thân > 256 KiB ⇒ 413 PAYLOAD_TOO_LARGE, use case không chạy", async () => {
    const calls: string[] = [];
    const big = JSON.stringify({ version: 1, fields: { title: "x".repeat(PATCH_BODY_MAX_BYTES) } });
    const r = await patch(app(calls), big);
    expect([r.status, await codeOf(r), calls]).toEqual([413, "PAYLOAD_TOO_LARGE", []]);
  });
  test("m-02 · PATCH thân hợp lệ lớn nhất (23 × 2.000 ký tự 3 byte) vẫn dưới trần", () => {
    const fields = Object.fromEntries(
      Array.from({ length: 23 }, (_, i) => [`k${i}`, "ệ".repeat(2000)]),
    );
    const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, fields })).byteLength;
    expect(bytes).toBeLessThan(PATCH_BODY_MAX_BYTES);
  });
  test("m-07 · PATCH giá trị chứa \\u0000 ⇒ 422 FIELD_INVALID trước use case", async () => {
    const calls: string[] = [];
    const r = await patch(
      app(calls),
      JSON.stringify({ version: 1, fields: { title: "a\u0000b" } }),
    );
    expect([r.status, await codeOf(r), calls]).toEqual([422, "FIELD_INVALID", []]);
  });
  test("m-06 · /source có nosniff + no-store + text/markdown", async () => {
    const r = await app([]).request(`/contracts/${ID}/source`);
    expect([
      r.status,
      r.headers.get("x-content-type-options"),
      r.headers.get("cache-control"),
      r.headers.get("content-type"),
    ]).toEqual([200, "nosniff", "no-store", "text/markdown; charset=utf-8"]);
  });
});

describe("HD1 review · biên zod + tên tệp", () => {
  test("m-07 · ListQuery: q/seller/buyer/signer chứa \\u0000 ⇒ trượt (400), chuỗi thường qua", () => {
    for (const k of ["q", "seller", "buyer", "signer"])
      expect(ContractListQuerySchema.safeParse({ [k]: "ab\u0000c" }).success).toBe(false);
    expect(ContractListQuerySchema.safeParse({ q: "abc", seller: "Công ty A" }).success).toBe(true);
    expect(UploadContractFormSchema.safeParse({ kind: "contract", title: "a\u0000" }).success).toBe(
      false,
    );
  });
  test("m-10 · cleanFileName bỏ C1 + bidi; cắt không tách surrogate", () => {
    const ch = (n: number) => String.fromCharCode(n);
    expect(cleanFileName(`hoa${ch(0x85)}don${ch(0x202e)}fdp.exe`)).toBe("hoadonfdp.exe");
    expect(cleanFileName(`a${ch(0x2066)}b${ch(0x200f)}c.pdf`)).toBe("abc.pdf");
    const emoji = "😀".repeat(200);
    const name = cleanFileName(`${emoji}.pdf`);
    expect(name.length).toBeLessThanOrEqual(255);
    expect(wellFormed(name)).toBe(true);
    expect(wellFormed(defaultTitle(`${emoji}.pdf`))).toBe(true);
    expect(defaultTitle(`${emoji}.pdf`).length).toBeLessThanOrEqual(200);
    expect(cutCodePoints("a😀", 2)).toBe("a");
  });
  test("m-14 · CONTRACTS_MAX_MB kẹp ≤ 20 MiB; nhỏ hơn giữ nguyên; sai ⇒ 20", () => {
    const old = process.env.CONTRACTS_MAX_MB;
    const mb = (v: string) => {
      process.env.CONTRACTS_MAX_MB = v;
      return contractsMaxBytes() / (1024 * 1024);
    };
    try {
      expect([mb("50"), mb("5"), mb("x")]).toEqual([20, 5, 20]);
    } finally {
      if (old === undefined) delete process.env.CONTRACTS_MAX_MB;
      else process.env.CONTRACTS_MAX_MB = old;
    }
  });
  test("m-11 · UPLOAD_MIME (bản sao ở application) khớp CONTRACT_FILE_MIME", () => {
    expect(UPLOAD_MIME).toEqual({ ...CONTRACT_FILE_MIME });
  });
});
