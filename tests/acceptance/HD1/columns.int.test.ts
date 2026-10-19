// D-07 · HD-BR-03 · HD-FR-02/07 · plan §3: cột sinh STORED (`number seller buyer seller_signer buyer_signer type value end_date
// signer_keys search_key`) + 4 hàm IMMUTABLE (`fold person_key as_bigint as_date`), parity TS ↔ SQL từng ký tự.
// Nguồn duy nhất vẫn là `fields` jsonb; cột sinh tính lại khi ghi `fields`.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { pgCode } from "../N1/_support/n1";
import { setupX2a } from "../X2a/_x2a";
import {
  cid,
  domainFn,
  inPack,
  insContract,
  mkFields,
  needContracts,
  ROLE_RW,
  type Sql,
  T,
  truncateAll,
  VI_PAIRS,
} from "./_support/hd1";

let sql: Sql;
beforeAll(async () => {
  sql = await setupX2a();
});
afterAll(async () => {
  await sql?.end();
});
const rw = <R>(fn: (tx: Sql) => Promise<R>) => inPack(T.acme, fn, ROLE_RW);
type Gen = {
  number: string | null;
  seller: string | null;
  buyer: string | null;
  seller_signer: string | null;
  buyer_signer: string | null;
  type: string | null;
  value: string | number | null;
  end_date: Date | string | null;
  signer_keys: string[];
  search_key: string;
};
const gen = async (id: string): Promise<Gen> =>
  (
    await sql<
      Gen[]
    >`select number, seller, buyer, seller_signer, buyer_signer, type, value, end_date, signer_keys, search_key
    from contracts.contracts where id = ${id}`
  )[0] as Gen;
const iso = (d: Date | string | null) => (d instanceof Date ? d.toISOString().slice(0, 10) : d);

describe("D-07 · cột sinh từ fields", () => {
  it("D-07 · lấy đúng giá trị: number, seller, buyer, người ký, type, value (bigint), end_date (date)", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, {
      id: cid(1),
      tenant: T.acme,
      title: "Hợp đồng bao bì Minh Phát",
      fields: mkFields({
        number: "HD-01",
        supplier_name: "  Công ty A  ",
        buyer_name: "Công ty B",
        supplier_representative: "Trần Thị B, Trưởng phòng",
        buyer_representative: "Nguyễn Văn A – Giám đốc",
        total_value: 123_456,
        end_date: "2027-03-31",
        type: "purchase",
      }),
    });
    const g = await gen(cid(1));
    expect({ ...g, value: Number(g.value), end_date: iso(g.end_date) }).toMatchObject({
      number: "HD-01",
      seller: "Công ty A",
      buyer: "Công ty B",
      seller_signer: "Trần Thị B, Trưởng phòng",
      buyer_signer: "Nguyễn Văn A – Giám đốc",
      type: "purchase",
      value: 123_456,
      end_date: "2027-03-31",
    });
  });
  it("HD-AC04 · signer_keys = [person_key(đại diện bán), person_key(đại diện mua)], bỏ null", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, {
      id: cid(1),
      tenant: T.acme,
      fields: mkFields({
        supplier_representative: "Trần Thị B, Trưởng phòng",
        buyer_representative: "Nguyễn Văn A – Giám đốc",
      }),
    });
    await insContract(sql, {
      id: cid(2),
      tenant: T.acme,
      fields: mkFields({ buyer_representative: " nguyễn  văn a " }),
    });
    await insContract(sql, { id: cid(3), tenant: T.acme, fields: {} });
    expect((await gen(cid(1))).signer_keys).toEqual(["tran thi b", "nguyen van a"]);
    expect((await gen(cid(2))).signer_keys).toEqual(["nguyen van a"]);
    expect((await gen(cid(3))).signer_keys).toEqual([]);
  });
  it("HD-AC12 · HĐ thiếu khoá / fields rỗng ⇒ cột sinh null (không lỗi), search_key = fold(title)", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, { id: cid(1), tenant: T.acme, title: "Đặng Thị Bé", fields: {} });
    const g = await gen(cid(1));
    expect(g).toMatchObject({
      number: null,
      seller: null,
      buyer: null,
      seller_signer: null,
      buyer_signer: null,
      type: null,
      value: null,
      end_date: null,
    });
    expect(g.search_key.trim()).toBe("dang thi be");
  });
  it("D-07 · giá trị sai kiểu/định dạng ⇒ cột null, không làm hỏng INSERT: value 'abc', end_date '31/12/2026', type 'lease', buyer '  '", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, {
      id: cid(1),
      tenant: T.acme,
      fields: mkFields({
        total_value: "abc",
        end_date: "31/12/2026",
        type: "lease",
        buyer_name: "   ",
      }),
    });
    const g = await gen(cid(1));
    expect(g).toMatchObject({ value: null, end_date: null, type: null, buyer: null });
  });
  it("D-07 · total_value dạng chuỗi số '1500000' ⇒ value 1500000 (as_bigint theo regex)", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, {
      id: cid(1),
      tenant: T.acme,
      fields: mkFields({ total_value: "1500000" }),
    });
    expect(Number((await gen(cid(1))).value)).toBe(1_500_000);
  });
  it("D-07 · search_key chứa title + trường chữ đã fold (không dấu, thường), KHÔNG chứa quote", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, {
      id: cid(1),
      tenant: T.acme,
      title: "Hợp đồng bao bì Minh Phát",
      fields: mkFields(
        { supplier_name: "Công ty TNHH Đông Á", buyer_name: "Bên Mua XYZ", number: "HĐ-07/2026" },
        { quote: "TRÍCH DẪN-RIÊNG" },
      ),
    });
    const k = (await gen(cid(1))).search_key;
    for (const part of [
      "hop dong bao bi minh phat",
      "cong ty tnhh dong a",
      "ben mua xyz",
      "hd-07/2026",
    ])
      expect(k).toContain(part);
    expect(k).not.toContain("trich dan-rieng");
    expect(k).toBe(k.toLowerCase());
  });
  it("D-07 · ghi lại fields ⇒ cột sinh tính lại (nguồn duy nhất là fields); không cho ghi trực tiếp cột sinh (428C9)", async () => {
    await needContracts(sql);
    await truncateAll(sql);
    await insContract(sql, { id: cid(1), tenant: T.acme, fields: mkFields({ buyer_name: "Cũ" }) });
    await sql`update contracts.contracts set fields = ${sql.json(mkFields({ buyer_name: "Mới", total_value: 7 }) as never)} where id = ${cid(1)}`;
    const g = await gen(cid(1));
    expect({ buyer: g.buyer, value: Number(g.value) }).toEqual({ buyer: "Mới", value: 7 });
    expect(
      await pgCode(() => sql`update contracts.contracts set seller = 'x' where id = ${cid(1)}`),
    ).toBe("428C9");
  });
});

describe("D-07 · hàm IMMUTABLE — thuộc tính và quyền", () => {
  const FNS = ["fold(text)", "person_key(text)", "as_bigint(text)", "as_date(text)"];
  it("D-07 · 4 hàm ở schema contracts: IMMUTABLE, ngôn ngữ sql, SET search_path = pg_catalog", async () => {
    await needContracts(sql);
    const rows = await sql<{ proname: string; v: string; lang: string; cfg: string[] | null }[]>`
      select p.proname, p.provolatile as v, l.lanname as lang, p.proconfig as cfg
      from pg_proc p join pg_language l on l.oid = p.prolang
      where p.pronamespace = 'contracts'::regnamespace and p.proname in ('fold', 'person_key', 'as_bigint', 'as_date') order by p.proname`;
    expect(
      rows.map((r) => [
        r.proname,
        r.v,
        r.lang,
        (r.cfg ?? []).some((c) => /^search_path=pg_catalog\b/.test(c)),
      ]),
    ).toEqual([
      ["as_bigint", "i", "sql", true],
      ["as_date", "i", "sql", true],
      ["fold", "i", "sql", true],
      ["person_key", "i", "sql", true],
    ]);
  });
  it("D-07 · EXECUTE chỉ cho contracts_rw (hub_api trần, không INHERIT, không gọi được)", async () => {
    await needContracts(sql);
    const out: Record<string, [boolean, boolean]> = {};
    for (const f of FNS) {
      const [r] = await sql<
        { rw: boolean; api: boolean }[]
      >`select has_function_privilege('contracts_rw', ${`contracts.${f}`}, 'execute') as rw,
        has_function_privilege('hub_api', ${`contracts.${f}`}, 'execute') as api`;
      out[f] = [r?.rw as boolean, r?.api as boolean];
    }
    expect(out).toEqual(Object.fromEntries(FNS.map((f) => [f, [true, false]])));
  });
});

describe("D-07 · parity TS ↔ SQL từng ký tự (fold, person_key)", () => {
  const corpus = (): string[] => {
    const out = [
      "",
      " ",
      "  a   b  ",
      "ABC-123/ Đ.ÔNG",
      "Công ty TNHH Bao Bì Minh Phát",
      "Nguyễn Văn A",
      " nguyễn văn  a ",
    ];
    for (const [accented] of VI_PAIRS)
      for (const ch of accented)
        out.push(ch, ch.toUpperCase(), `x${ch}y`, `${ch.toUpperCase()}${ch}`);
    out.push("Đ", "đ", "ĐẶNG THỊ BÉ", "Phạm  Ngọc\tThạch", "Nguyễn Văn A – Giám đốc");
    return out;
  };
  it("D-07 · contracts.fold(x) ≡ foldVi(x) với mọi chữ có dấu VI (hoa+thường), đ/Đ, khoảng trắng, ASCII", async () => {
    await needContracts(sql);
    const foldVi = await domainFn<(s: string) => string>("foldVi");
    const xs = corpus();
    const got = await rw(
      (tx) =>
        tx<
          { x: string; f: string }[]
        >`select x, contracts.fold(x) as f from unnest(${xs}::text[]) as x`,
    );
    expect(got.map((r) => [r.x, r.f])).toEqual(xs.map((x) => [x, foldVi(x)]));
  });
  it("D-07 · contracts.person_key(x) ≡ personKey(x) (cắt ' – ', ' - ', ','; rỗng ⇒ null; gạch nối liền giữ)", async () => {
    await needContracts(sql);
    const personKey = await domainFn<(s: string | null) => string | null>("personKey");
    const xs = [
      "Nguyễn Văn A",
      " nguyễn  văn a ",
      "Nguyễn Văn A – Giám đốc",
      "Nguyễn Văn A - Giám đốc",
      "Nguyễn Văn A, Giám đốc",
      "Trần Anh-Tuấn",
      " – Giám đốc",
      ", x",
      "",
      "   ",
      "Đặng Thị Bé",
    ];
    const got = await rw(
      (tx) =>
        tx<
          { x: string; k: string | null }[]
        >`select x, contracts.person_key(x) as k from unnest(${xs}::text[]) as x`,
    );
    expect(got.map((r) => [r.x, r.k])).toEqual(xs.map((x) => [x, personKey(x)]));
    const [nul] = await rw(
      (tx) => tx<{ k: string | null }[]>`select contracts.person_key(null) as k`,
    );
    expect(nul?.k).toBeNull();
  });
  it("D-07 · as_bigint: chuỗi số nguyên ⇒ bigint; còn lại (rỗng, 'abc', '1.5', '12a', null) ⇒ null", async () => {
    await needContracts(sql);
    const xs = ["0", "123456", "-5", "9007199254740993", "", "abc", "1.5", "12a", " 12"];
    const got = await rw(
      (tx) =>
        tx<
          { x: string; b: string | null }[]
        >`select x, contracts.as_bigint(x)::text as b from unnest(${xs}::text[]) as x`,
    );
    expect(got.map((r) => r.b)).toEqual([
      "0",
      "123456",
      "-5",
      "9007199254740993",
      null,
      null,
      null,
      null,
      null,
    ]);
    expect(
      (await rw((tx) => tx<{ b: string | null }[]>`select contracts.as_bigint(null)::text as b`))[0]
        ?.b,
    ).toBeNull();
  });
  it("D-07 · as_date: ISO 'YYYY-MM-DD' ⇒ date; '31/12/2026', '2027-3-1', '', null ⇒ null", async () => {
    await needContracts(sql);
    const xs = ["2027-03-31", "2026-02-28", "31/12/2026", "2027-3-1", "", "abc"];
    const got = await rw(
      (tx) =>
        tx<
          { x: string; d: string | null }[]
        >`select x, contracts.as_date(x)::text as d from unnest(${xs}::text[]) as x`,
    );
    expect(got.map((r) => r.d)).toEqual(["2027-03-31", "2026-02-28", null, null, null, null]);
    expect(
      (await rw((tx) => tx<{ d: string | null }[]>`select contracts.as_date(null)::text as d`))[0]
        ?.d,
    ).toBeNull();
  });
});
