// ADM-FR-50, ADM-BR-04, ADM-BR-14, ADM-NFR-01 · API /admin/secrets (test-plan S; AC-A06; M2-AC02; M2-R01…R06).
// Workflow tham chiếu dựng bằng owner SQL (T3: chưa có module workflows).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { SecretListResponseSchema, SecretSchema } from "@ai/contracts";
import postgres from "postgres";
import { newMasterKeyB64, openIndependent } from "./_crypto";
import { LEAK_1, LEAK_2, LEAK_EMOJI, LEAK_SHORT, leakForms } from "./_data";
import {
  ADMIN_API_URL,
  createM2Env,
  expectErr,
  type Json,
  type M2Env,
  type Res,
} from "./_fixtures";

let env: M2Env;
const CATALOG = {
  secrets: ["DIFY_TRANSLATE_KEY", "DIFY_INVOICE_KEY", "DIFY_OLD_KEY"],
  workflows: ["translate", "invoice-check", "summarize"],
};

beforeAll(async () => {
  env = await createM2Env({ catalog: CATALOG });
});
afterAll(async () => {
  await env.close();
});
beforeEach(async () => {
  await env.reset(CATALOG);
});

const as = async (method: string, path: string, body?: unknown, token?: string): Promise<Res> =>
  env.call(method, path, { token: token ?? (await env.admin()), body });
const create = (name: string, value: string, note?: string) =>
  as("POST", "/admin/secrets", { name, value, ...(note === undefined ? {} : { note }) });
const row = async (name: string) => {
  const [r] =
    await env.owner`select id, ciphertext, iv, key_version, last4, note, updated_at, updated_by
    from admin.secrets where name = ${name}`;
  return r as Json;
};
const open = (r: Json, key = env.masterKeyB64) =>
  openIndependent(key, r.id, r.key_version, { ciphertext: r.ciphertext, iv: r.iv });
const allText = (res: Res) => `${res.text}\n${[...res.headers.entries()].flat().join("\n")}`;

describe("ADM-FR-50 · tạo secret (POST)", () => {
  it("ADM-FR-50 · M2-R01 · M2-R03 · tạo → 201 SecretSchema: có id v7, last4, used_by [], updated_by 'admin'; không có value/ciphertext/iv/key_version", async () => {
    const res = await create("DIFY_NEW_KEY", LEAK_1, "App Translate trên Dify prod");
    expect(res.status).toBe(201);
    const s = SecretSchema.parse(res.json);
    expect(s).toMatchObject({
      name: "DIFY_NEW_KEY",
      last4: LEAK_1.slice(-4),
      note: "App Translate trên Dify prod",
      used_by: [],
      updated_by: "admin",
    });
    expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const k of ["value", "ciphertext", "iv", "key_version"])
      expect(res.json).not.toHaveProperty(k);
  });

  it("ADM-FR-50 · M2-R01 · tên gửi chữ thường/dư khoảng trắng → lưu HOA; ghi chú '' → null", async () => {
    const res = await create(" dify_x_key ", "12345678", "");
    expect(res.status).toBe(201);
    expect(res.json.name).toBe("DIFY_X_KEY");
    expect(res.json.note).toBeNull();
  });

  it("ADM-FR-50 · M2-R01 · validate → 400 VALIDATION_ERROR: value 7/2049/thiếu, tên sai, ghi chú 201, khoá lạ; details.issues chỉ có path/code/message", async () => {
    const bodies: unknown[] = [
      { name: "DIFY_BAD1", value: LEAK_SHORT },
      { name: "DIFY_BAD2", value: "x".repeat(2049) },
      { name: "DIFY_BAD3" },
      { value: "12345678" },
      { name: "A", value: "12345678" },
      { name: "DIFY-KEY", value: "12345678" },
      { name: "A".repeat(65), value: "12345678" },
      { name: "DIFY_BAD4", value: "12345678", note: "n".repeat(201) },
      { name: "DIFY_BAD5", value: "12345678", extra: 1 },
    ];
    for (const body of bodies) {
      const res = await as("POST", "/admin/secrets", body);
      expectErr(res, "VALIDATION_ERROR");
      for (const i of res.json.error.details.issues) {
        expect(Object.keys(i).sort()).toEqual(["code", "message", "path"]);
      }
      expect(allText(res)).not.toContain(LEAK_SHORT);
    }
    const n =
      await env.owner`select count(*)::int as n from admin.secrets where name like 'DIFY_BAD%'`;
    expect(n[0]?.n).toBe(0);
  });

  it("ADM-FR-50 · M2-R01 · JSON hỏng → 400 invalid_json, không echo nội dung", async () => {
    const res = await env.call("POST", "/admin/secrets", {
      token: await env.admin(),
      raw: `{"name":"DIFY_JSON","value":"${LEAK_1}`,
    });
    expectErr(res, "VALIDATION_ERROR");
    expect(res.json.error.details.issues[0].code).toBe("invalid_json");
    expect(allText(res)).not.toContain(LEAK_1);
  });

  it("ADM-FR-50 · M2-R01 · biên giá trị: 8 và 2048 ký tự ok (bản mã DB = utf8 + 16 byte); không trim; emoji → last4 4 code point", async () => {
    expect((await create("DIFY_LEN8", "12345678")).status).toBe(201);
    expect((await create("DIFY_LEN2048", "x".repeat(2048))).status).toBe(201);
    expect((await row("DIFY_LEN2048")).ciphertext.length).toBe(2048 + 16);
    const padded = "  abcdefg  ";
    expect((await create("DIFY_PAD", padded)).status).toBe(201);
    expect(open(await row("DIFY_PAD"))).toBe(padded);
    const e = await create("DIFY_EMOJI", LEAK_EMOJI);
    expect(e.status).toBe(201);
    expect(e.json.last4).toBe(LEAK_EMOJI);
    expect(open(await row("DIFY_EMOJI"))).toBe(LEAK_EMOJI);
  });

  it("ADM-FR-50 · M2-R04 · tên trùng (kể cả viết thường) → 409 SECRET_NAME_TAKEN; bản mã hàng cũ không đổi", async () => {
    const before = await row("DIFY_OLD_KEY");
    for (const name of ["DIFY_OLD_KEY", "dify_old_key"]) {
      expectErr(await create(name, "12345678"), "SECRET_NAME_TAKEN");
    }
    const after = await row("DIFY_OLD_KEY");
    expect(Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext))).toBe(true);
  });
});

describe("ADM-FR-50 · thay giá trị (PUT) và sửa ghi chú (PATCH)", () => {
  it("ADM-FR-50 · M2-R04 · PUT {value}: 200, id giữ nguyên, last4 mới, iv + ciphertext mới, note và used_by giữ nguyên", async () => {
    await create("DIFY_PUT_KEY", LEAK_1, "ghi chú giữ");
    const before = await row("DIFY_PUT_KEY");
    const res = await as("PUT", "/admin/secrets/DIFY_PUT_KEY", { value: LEAK_2 });
    expect(res.status).toBe(200);
    const s = SecretSchema.parse(res.json);
    expect(s).toMatchObject({
      id: before.id,
      last4: LEAK_2.slice(-4),
      note: "ghi chú giữ",
      used_by: [],
    });
    const after = await row("DIFY_PUT_KEY");
    expect(Buffer.from(after.iv).equals(Buffer.from(before.iv))).toBe(false);
    expect(Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext))).toBe(false);
    expect(open(after)).toBe(LEAK_2);
    expect(after.updated_by).toBeTruthy();
  });

  it("ADM-FR-50 · M2-R04 · PUT cùng giá trị cũ vẫn đổi iv; PUT secret đang dùng giữ used_by", async () => {
    await create("DIFY_SAME", LEAK_1);
    const before = await row("DIFY_SAME");
    expect((await as("PUT", "/admin/secrets/DIFY_SAME", { value: LEAK_1 })).status).toBe(200);
    expect(Buffer.from((await row("DIFY_SAME")).iv).equals(Buffer.from(before.iv))).toBe(false);
    const used = await as("PUT", "/admin/secrets/DIFY_TRANSLATE_KEY", { value: LEAK_2 });
    expect(used.status).toBe(200);
    expect(used.json.used_by).toEqual(["translate"]);
  });

  it("ADM-FR-50 · M2-R04 · PUT lỗi: body có note/khoá lạ → 400; :name không tồn tại → 404; :name sai dạng (dify_x, A, A B) → 404", async () => {
    expectErr(
      await as("PUT", "/admin/secrets/DIFY_OLD_KEY", { value: LEAK_2, note: "x" }),
      "VALIDATION_ERROR",
    );
    expectErr(
      await as("PUT", "/admin/secrets/DIFY_OLD_KEY", { value: LEAK_SHORT }),
      "VALIDATION_ERROR",
    );
    expectErr(await as("PUT", "/admin/secrets/DIFY_KHONG_CO", { value: LEAK_2 }), "NOT_FOUND");
    for (const bad of ["dify_old_key", "A", "A%20B"]) {
      expectErr(await as("PUT", `/admin/secrets/${bad}`, { value: LEAK_2 }), "NOT_FOUND");
    }
  });

  it("ADM-FR-50 · M2-R04 · PATCH {note}: ciphertext và iv BYTE-BẰNG trước; last4 giữ; note:null xoá ghi chú", async () => {
    const before = await row("DIFY_OLD_KEY");
    const res = await as("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "Đã đổi ghi chú" });
    expect(res.status).toBe(200);
    expect(res.json).toMatchObject({ note: "Đã đổi ghi chú", last4: before.last4 });
    const after = await row("DIFY_OLD_KEY");
    expect(Buffer.from(after.ciphertext).equals(Buffer.from(before.ciphertext))).toBe(true);
    expect(Buffer.from(after.iv).equals(Buffer.from(before.iv))).toBe(true);
    const cleared = await as("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: null });
    expect(cleared.status).toBe(200);
    expect(cleared.json.note).toBeNull();
  });

  it("ADM-FR-50 · M2-R04 · PATCH lỗi: ghi chú 201 ký tự, value trong body, thiếu note → 400; :name lạ → 404", async () => {
    expectErr(
      await as("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "n".repeat(201) }),
      "VALIDATION_ERROR",
    );
    expectErr(
      await as("PATCH", "/admin/secrets/DIFY_OLD_KEY", { note: "x", value: LEAK_2 }),
      "VALIDATION_ERROR",
    );
    expectErr(await as("PATCH", "/admin/secrets/DIFY_OLD_KEY", {}), "VALIDATION_ERROR");
    expectErr(await as("PATCH", "/admin/secrets/DIFY_KHONG_CO", { note: "x" }), "NOT_FOUND");
  });
});

describe("ADM-FR-50 · xoá secret (DELETE)", () => {
  it("ADM-FR-50 · M2-R05 · không dùng → 204 (xoá thật); lần sau → 404; không còn trong list", async () => {
    const res = await as("DELETE", "/admin/secrets/DIFY_OLD_KEY");
    expect(res.status).toBe(204);
    expect(await row("DIFY_OLD_KEY")).toBeUndefined();
    expectErr(await as("DELETE", "/admin/secrets/DIFY_OLD_KEY"), "NOT_FOUND");
    const list = await as("GET", "/admin/secrets");
    expect(list.json.items.map((s: Json) => s.name)).not.toContain("DIFY_OLD_KEY");
  });

  it("ADM-FR-50 · M2-R05 · đang có workflow tham chiếu → 409 SECRET_IN_USE {used_by} sắp tăng dần; DB giữ nguyên", async () => {
    const t = await as("DELETE", "/admin/secrets/DIFY_TRANSLATE_KEY");
    expectErr(t, "SECRET_IN_USE");
    expect(t.json.error.details).toEqual({ used_by: ["translate"] });
    const i = await as("DELETE", "/admin/secrets/DIFY_INVOICE_KEY");
    expectErr(i, "SECRET_IN_USE");
    expect(i.json.error.details).toEqual({ used_by: ["invoice-check", "summarize"] });
    expect(await row("DIFY_TRANSLATE_KEY")).toBeDefined();
  });

  it("ADM-FR-50 · M2-R05 · thứ tự kiểm: 404 trước SECRET_IN_USE; :name sai dạng → 404", async () => {
    expectErr(await as("DELETE", "/admin/secrets/DIFY_KHONG_CO"), "NOT_FOUND");
    expectErr(await as("DELETE", "/admin/secrets/dify_translate_key"), "NOT_FOUND");
  });
});

describe("ADM-FR-50 · danh sách (GET)", () => {
  it("ADM-FR-50 · M2-R26 · {items,total,counts}: sắp name tăng dần; counts {all:3,used:2,unused:1}; item parse SecretSchema strict", async () => {
    const res = await as("GET", "/admin/secrets");
    expect(res.status).toBe(200);
    const body = SecretListResponseSchema.parse(res.json);
    expect(body.items.map((s) => s.name)).toEqual([
      "DIFY_INVOICE_KEY",
      "DIFY_OLD_KEY",
      "DIFY_TRANSLATE_KEY",
    ]);
    expect(body.total).toBe(3);
    expect(body.counts).toEqual({ all: 3, used: 2, unused: 1 });
    expect(body.items.find((s) => s.name === "DIFY_TRANSLATE_KEY")).toMatchObject({
      last4: "7f3a",
      used_by: ["translate"],
      note: "App Translate trên Dify prod",
    });
  });

  it("ADM-FR-50 · M2-R26 · ?used=true|false lọc đúng; counts KHÔNG đổi theo ?used=; ?used=1 → 400", async () => {
    const used = await as("GET", "/admin/secrets?used=true");
    expect(used.json.items.map((s: Json) => s.name)).toEqual([
      "DIFY_INVOICE_KEY",
      "DIFY_TRANSLATE_KEY",
    ]);
    expect(used.json.counts).toEqual({ all: 3, used: 2, unused: 1 });
    const unused = await as("GET", "/admin/secrets?used=false");
    expect(unused.json.items.map((s: Json) => s.name)).toEqual(["DIFY_OLD_KEY"]);
    expect(unused.json.total).toBe(1);
    expectErr(await as("GET", "/admin/secrets?used=1"), "VALIDATION_ERROR");
  });

  it("ADM-FR-50 · M2-R26 · q khớp name và note (không phân biệt hoa thường); limit/offset/total; limit=201 → 400", async () => {
    const byName = await as("GET", "/admin/secrets?q=invoice");
    expect(byName.json.items.map((s: Json) => s.name)).toEqual(["DIFY_INVOICE_KEY"]);
    const byNote = await as("GET", "/admin/secrets?q=chờ%20xoá");
    expect(byNote.json.items.map((s: Json) => s.name)).toEqual(["DIFY_OLD_KEY"]);
    const page = await as("GET", "/admin/secrets?limit=1&offset=1");
    expect(page.json.items.map((s: Json) => s.name)).toEqual(["DIFY_OLD_KEY"]);
    expect(page.json.total).toBe(3);
    expectErr(await as("GET", "/admin/secrets?limit=201"), "VALIDATION_ERROR");
  });

  it("ADM-BR-04 · AC-A06 · không có tham số nào làm xuất hiện giá trị: ?reveal=1, ?include=value, ?export=1 → 400 (khoá lạ)", async () => {
    for (const q of ["reveal=1", "include=value", "export=1", "format=csv"]) {
      expectErr(await as("GET", `/admin/secrets?${q}`), "VALIDATION_ERROR");
    }
  });
});

describe("ADM-FR-50 · M2-AC02 · bản mã trong DB", () => {
  it("ADM-FR-50 · M2-AC02 · ghi bằng LEAK_1: ciphertext không chứa plaintext; giải mã ĐỘC LẬP theo plan §3.2 ra đúng giá trị; key_version = 1", async () => {
    const res = await create("DIFY_AC02", LEAK_1);
    const r = await row("DIFY_AC02");
    expect(r.id).toBe(res.json.id);
    expect(r.key_version).toBe(1);
    expect(r.iv.length).toBe(12);
    for (const f of leakForms(LEAK_1)) {
      expect(Buffer.from(r.ciphertext).toString("utf8")).not.toContain(f);
      expect(Buffer.from(r.ciphertext).toString("hex")).not.toContain(f);
    }
    expect(open(r)).toBe(LEAK_1);
  });

  it("ADM-FR-50 · M2-AC02 · hai secret cùng giá trị cho iv và ciphertext khác nhau", async () => {
    await create("DIFY_TWIN_A", LEAK_1);
    await create("DIFY_TWIN_B", LEAK_1);
    const [a, b] = [await row("DIFY_TWIN_A"), await row("DIFY_TWIN_B")];
    expect(Buffer.from(a.iv).equals(Buffer.from(b.iv))).toBe(false);
    expect(Buffer.from(a.ciphertext).equals(Buffer.from(b.ciphertext))).toBe(false);
  });

  it("ADM-FR-50 · M2-AC02 · sai khoá và AAD sai (id khác / key_version 2 / thiếu tiền tố) không giải mã được", async () => {
    await create("DIFY_AAD", LEAK_1);
    const r = await row("DIFY_AAD");
    const sealed = { ciphertext: r.ciphertext, iv: r.iv };
    expect(() => openIndependent(newMasterKeyB64(), r.id, 1, sealed)).toThrow();
    expect(() =>
      openIndependent(env.masterKeyB64, "01900000-0000-7000-8000-0000000002f7", 1, sealed),
    ).toThrow();
    expect(() => openIndependent(env.masterKeyB64, r.id, 2, sealed)).toThrow();
    expect(() =>
      openIndependent(env.masterKeyB64, r.id, 1, sealed, Buffer.from(r.id, "utf8")),
    ).toThrow();
  });

  it("ADM-BR-04 · ADM-NFR-07 · admin_api (scope platform) select ciphertext → 42501 kể cả sau khi tạo qua app", async () => {
    await create("DIFY_PERM", LEAK_1);
    const db = postgres(ADMIN_API_URL, { max: 1, onnotice: () => {} });
    let code: string | undefined;
    try {
      await db.begin(async (tx) => {
        await tx`select set_config('app.scope', 'platform', true)`;
        await tx`select ciphertext from admin.secrets`;
      });
    } catch (e) {
      code = (e as { code?: string }).code;
    } finally {
      await db.end();
    }
    expect(code).toBe("42501");
  });
});

describe("ADM-BR-04 · AC-A06 · không rò giá trị qua API", () => {
  it("AC-A06 · ADM-BR-04 · sau chuỗi tạo → thay → sửa ghi chú → xoá và các lỗi 400/404/409: mọi response (thân + header) không chứa LEAK_1/LEAK_2 (thô, base64, hex)", async () => {
    const responses: Res[] = [];
    responses.push(await create("DIFY_LEAK", LEAK_1, "ghi chú"));
    responses.push(await create("DIFY_LEAK", LEAK_1));
    responses.push(await create("DIFY_LEAK2", LEAK_SHORT));
    responses.push(await as("PUT", "/admin/secrets/DIFY_LEAK", { value: LEAK_2 }));
    responses.push(await as("PUT", "/admin/secrets/DIFY_NONE", { value: LEAK_2 }));
    responses.push(await as("PATCH", "/admin/secrets/DIFY_LEAK", { note: "mới" }));
    responses.push(await as("GET", "/admin/secrets"));
    responses.push(await as("GET", "/admin/secrets?q=LEAK"));
    responses.push(await as("DELETE", "/admin/secrets/DIFY_TRANSLATE_KEY"));
    responses.push(await as("DELETE", "/admin/secrets/DIFY_LEAK"));
    responses.push(await as("DELETE", "/admin/secrets/DIFY_LEAK"));
    const forms = [...leakForms(LEAK_1), ...leakForms(LEAK_2)];
    const hits = responses
      .map((r, i) => [i, allText(r)] as const)
      .filter(([, t]) => forms.some((f) => t.includes(f)))
      .map(([i]) => i);
    expect(hits).toEqual([]);
    expect(responses.map((r) => r.status)).toEqual([
      201, 409, 400, 200, 404, 200, 200, 200, 409, 204, 404,
    ]);
  });

  it("ADM-NFR-01 · app dựng KHÔNG có secretKey: POST/PUT /admin/secrets → 500 INTERNAL_ERROR không lộ giá trị/stack; GET vẫn 200", async () => {
    const bare = await env.makeCaller({ secretKey: false });
    const token = await env.admin();
    const post = await bare.call("POST", "/admin/secrets", {
      token,
      body: { name: "DIFY_NOKEY", value: LEAK_1 },
    });
    expectErr(post, "INTERNAL_ERROR");
    expect(allText(post)).not.toContain(LEAK_1);
    expect(post.text).not.toMatch(/stack|\bat\s.+\(/i);
    const put = await bare.call("PUT", "/admin/secrets/DIFY_OLD_KEY", {
      token,
      body: { value: LEAK_1 },
    });
    expectErr(put, "INTERNAL_ERROR");
    expect((await bare.call("GET", "/admin/secrets", { token })).status).toBe(200);
    expect(await row("DIFY_NOKEY")).toBeUndefined();
  });
});

describe("ADM-FR-50 · đồng thời", () => {
  it("ADM-FR-50 · M2-R04 · hai POST cùng name song song ×10 → đúng 1×201 và 1×409 SECRET_NAME_TAKEN", async () => {
    for (let i = 0; i < 10; i++) {
      const name = `DIFY_RACE_${i}`;
      const [a, b] = await Promise.all([create(name, LEAK_1), create(name, LEAK_2)]);
      expect([a.status, b.status].sort()).toEqual([201, 409]);
      const lose = a.status === 409 ? a : b;
      expect(lose.json.error.code).toBe("SECRET_NAME_TAKEN");
      const n = await env.owner`select count(*)::int as n from admin.secrets where name = ${name}`;
      expect(n[0]?.n).toBe(1);
    }
  });

  it("ADM-FR-50 · M2-R04 · PUT ∥ PATCH ghi chú cùng secret → cả hai 200; kết quả cuối có CẢ giá trị mới và ghi chú mới", async () => {
    for (let i = 0; i < 5; i++) {
      const name = `DIFY_BOTH_${i}`;
      await create(name, LEAK_1, "cũ");
      const [p, n] = await Promise.all([
        as("PUT", `/admin/secrets/${name}`, { value: LEAK_2 }),
        as("PATCH", `/admin/secrets/${name}`, { note: "mới" }),
      ]);
      expect([p.status, n.status]).toEqual([200, 200]);
      const r = await row(name);
      expect(open(r)).toBe(LEAK_2);
      expect(r.note).toBe("mới");
      expect(r.last4).toBe(LEAK_2.slice(-4));
    }
  });

  it("ADM-FR-50 · M2-R05 · DELETE secret ∥ chèn workflow tham chiếu (owner SQL) → không workflow mồ côi; không cả hai cùng thành công", async () => {
    for (let i = 0; i < 5; i++) {
      const name = `DIFY_DEL_${i}`;
      const created = await create(name, LEAK_1);
      const wid = `01900000-0000-7000-8000-00000000029${i}`;
      const [del, ins] = await Promise.all([
        as("DELETE", `/admin/secrets/${name}`),
        env.owner`insert into admin.workflows (id, key, name, description, app_type, base_url, secret_id)
          values (${wid}, ${`race-${i}`}, 'R', ${"r".repeat(25)}, 'chat', 'https://x.example.com', ${created.json.id})`
          .then(() => true)
          .catch(() => false),
      ]);
      expect([204, 409]).toContain(del.status);
      expect(del.status === 204 && ins).toBe(false);
      const orphan = await env.owner`select count(*)::int as n from admin.workflows w
        where not exists (select 1 from admin.secrets s where s.id = w.secret_id)`;
      expect(orphan[0]?.n).toBe(0);
    }
  });
});
