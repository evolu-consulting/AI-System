// HUB-FR-68 · HUB-FR-04 · HUB-BR-30 · AC-H4b1-01 · AC-H4b1-07 (vế Hub, Q12 mặc định) · plan §5 · test-plan H4b1 §3 A90–A94:
// chạy trọn vòng đời qua API (tạo 3 loại, list, get, thay, xung đột, trùng tên, validate, đang dùng, xoá, route tenant) với
// log Hub + console bị bắt; sau đó KHÔNG chuỗi giá trị nào xuất hiện trong: mọi response, mọi dòng log, audit, mọi bảng `hub.*`
// (`x::text` — bản mã là bytea hex nên không trùng bản rõ). Đỏ trước code: route chưa có ⇒ vòng đời đỏ ở expect status.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import {
  type Ctx,
  captureAll,
  create,
  expectNoValue,
  idGen,
  idOf,
  insertProvider,
  type LogCap,
  type Res,
  startH4b1,
  studio,
  T,
  tenantApi,
  val,
} from "./_h4b1";

let x: Ctx;
let cap: LogCap;
const id = idGen(5000);
const values: string[] = [];
const responses: Res[] = [];
const v = (tag: string) => {
  const s = val(`leak-${tag}`);
  values.push(s);
  return s;
};
const keep = (r: Res) => {
  responses.push(r);
  return r;
};

beforeAll(async () => {
  x = await startH4b1();
  cap = captureAll();
}, 60_000);
afterAll(async () => {
  cap?.restore();
  await x?.stop();
});

describe("A90 · vòng đời qua API [AC-H4b1-01]", () => {
  it("HUB-FR-68 · AC-H4b1-01 · A90 · tạo/list/get/thay/xung đột/trùng/validate/đang dùng/xoá + route tenant ⇒ đúng status từng bước", async () => {
    const p = keep(
      await create(x, { kind: "provider_api_key", name: "anthropic-main", value: v("p1") }),
    );
    const k = keep(await create(x, { kind: "kh_api_key", name: "kh-main", value: v("k1") }));
    const s = keep(
      await create(x, {
        kind: "source_credential",
        name: "git-acme",
        value: v("s1"),
        tenant_id: T.acme,
      }),
    );
    const steps: [string, number][] = [
      ["create p", p.status],
      ["create k", k.status],
      ["create s", s.status],
      ["list", keep(await studio(x, "padmin", "GET")).status],
      ["get", keep(await studio(x, "padmin", "GET", `/${idOf(p)}`)).status],
      [
        "rotate",
        keep(await studio(x, "padmin", "PUT", `/${idOf(p)}`, { version: 1, value: v("p2") }))
          .status,
      ],
      [
        "conflict",
        keep(await studio(x, "padmin", "PUT", `/${idOf(p)}`, { version: 1, value: v("p3") }))
          .status,
      ],
      [
        "taken",
        keep(await create(x, { kind: "provider_api_key", name: "Anthropic-Main", value: v("p4") }))
          .status,
      ],
      [
        "short",
        keep(await create(x, { kind: "provider_api_key", name: "qc-short", value: "Lk7Shrt" }))
          .status,
      ],
      [
        "strict",
        keep(
          await studio(x, "padmin", "POST", "", {
            kind: "kh_api_key",
            name: "qc-x",
            value: v("x1"),
            extra: v("x2"),
          }),
        ).status,
      ],
      [
        "tenant create",
        keep(await tenantApi(x, "tadmin", "POST", "", { name: "git-tenant", value: v("t1") }))
          .status,
      ],
      ["tenant list", keep(await tenantApi(x, "tadmin", "GET")).status],
      [
        "tenant forbidden",
        keep(
          await studio(x, "tadmin", "POST", "", {
            kind: "provider_api_key",
            name: "qc-y",
            value: v("y1"),
          }),
        ).status,
      ],
    ];
    await insertProvider(x.sql, id(), "leak-api", idOf(k));
    steps.push([
      "in use",
      keep(await studio(x, "padmin", "DELETE", `/${idOf(k)}?version=1`)).status,
    ]);
    steps.push([
      "delete",
      keep(await studio(x, "padmin", "DELETE", `/${idOf(s)}?version=1`)).status,
    ]);
    values.push("Lk7Shrt");
    expect(steps).toEqual([
      ["create p", 201],
      ["create k", 201],
      ["create s", 201],
      ["list", 200],
      ["get", 200],
      ["rotate", 200],
      ["conflict", 409],
      ["taken", 409],
      ["short", 400],
      ["strict", 400],
      ["tenant create", 201],
      ["tenant list", 200],
      ["tenant forbidden", 403],
      ["in use", 409],
      ["delete", 204],
    ]);
  });
});

describe("A91–A94 · không nơi nào chứa giá trị [AC-H4b1-01 · AC-H4b1-07 · HUB-BR-30]", () => {
  it("HUB-FR-68 · AC-H4b1-01 · A91 · mọi response (thân + header) không chứa giá trị (kể cả 400 value ngắn, 409 current)", async () => {
    expect(responses.filter((r) => r.status === 201).length).toBe(4);
    const all = responses.map((r) => r.text + JSON.stringify([...r.headers.entries()])).join("\n");
    expectNoValue(all, values);
  });
  it("HUB-FR-04 · AC-H4b1-07 · A92 · log Hub + console trong suốt vòng đời không chứa giá trị", async () => {
    expect(responses[0]?.status).toBe(201); // vòng đời A90 phải chạy thật
    expectNoValue(cap.lines.join("\n"), values);
  });
  it("HUB-FR-69 · AC-H4b1-01 · A93 · audit (before/after/summary/entity_name) của mọi hàng entity secret không chứa giá trị; có ≥ 5 hàng", async () => {
    const rows = await x.sql`select * from hub.audit_log where entity = 'secret' order by seq`;
    expect(rows.length).toBeGreaterThanOrEqual(5);
    expectNoValue(JSON.stringify(rows), values);
    for (const r of rows)
      for (const snap of [r.before, r.after].filter(Boolean))
        expect(Object.keys(snap).sort()).toEqual(["kind", "name", "tenant_id", "version"]);
  });
  it("HUB-BR-30 · AC-H4b1-07 · Q12 · A94 · quét mọi bảng schema hub (`x::text`) ⇒ không bảng nào chứa chuỗi giá trị", async () => {
    const tables = await x.sql<
      { t: string }[]
    >`select table_name as t from information_schema.tables
      where table_schema = 'hub' and table_type = 'BASE TABLE' order by 1`;
    expect(tables.some((r) => r.t === "secrets")).toBe(true);
    const hits: string[] = [];
    for (const { t } of tables)
      for (const s of values) {
        const [r] = await x.sql.unsafe(
          `select count(*)::int as n from hub."${t}" x where x::text like '%' || $1 || '%'`,
          [s],
        );
        if ((r?.n ?? 0) > 0) hits.push(`${t}:${s}`);
      }
    expect(hits).toEqual([]);
  });
});
