// HD-BR-01 · HD-AC08 · HD-FR-02 · HD-AC12 · luật thuần `fillFields` / `mergeFields` / `applyEdits` (plan §4; ingest.py:63-65, manual.py:16).
// Gọi hàm domain theo tên (nạp `M/domain/*.rules.ts`); thiếu ⇒ đỏ NGAY "chưa có tính năng". Không DB.
import { describe, expect, it } from "bun:test";
import { domainFn, emptyField, FIELD_KEYS, type FieldKey } from "../_support/pure";

// biome-ignore lint/suspicious/noExplicitAny: ContractFields chưa tồn tại khi viết test
type CF = Record<string, any>;
type Fill = (raw: unknown) => CF;
type Merge = (old: CF, next: CF) => CF;
type Apply = (
  old: CF,
  edits: Partial<Record<FieldKey, unknown>>,
) => { fields: CF; changes: { key: string; old: unknown; new: unknown }[] };
const fill = () => domainFn<Fill>("fillFields");
const merge = () => domainFn<Merge>("mergeFields");
const apply = () => domainFn<Apply>("applyEdits");
const f = (value: unknown, o: { edited?: boolean; quote?: string; verified?: boolean } = {}) => ({
  value,
  quote: o.quote ?? "",
  verified: o.verified ?? false,
  edited: o.edited ?? false,
});
const deepFreeze = <V>(o: V): V => {
  if (o && typeof o === "object") {
    Object.freeze(o);
    for (const v of Object.values(o)) deepFreeze(v);
  }
  return o;
};

describe("HD-FR-02 · HD-AC12 · fillFields", () => {
  it("HD-AC12 · raw null/undefined/{} ⇒ đủ 23 khoá, mỗi khoá {value:null, quote:'', verified:false, edited:false}", async () => {
    const fillFields = await fill();
    for (const raw of [null, undefined, {}]) {
      const out = fillFields(raw);
      expect(Object.keys(out).sort()).toEqual([...FIELD_KEYS].sort());
      expect(
        Object.values(out).every((v) => JSON.stringify(v) === JSON.stringify(emptyField())),
      ).toBe(true);
    }
    expect(FIELD_KEYS).toHaveLength(23);
  });
  it("HD-AC12 · HĐ cũ thiếu buyer_representative ⇒ khoá đó rỗng, khoá còn lại giữ nguyên", async () => {
    const out = (await fill())({ number: f("HD-1", { verified: true }) });
    expect(out.number).toEqual(f("HD-1", { verified: true }));
    expect(out.buyer_representative).toEqual(emptyField());
  });
  it("HD-FR-02 · khoá lạ bị bỏ khi ĐỌC (không lỗi, không lọt ra ngoài 23 khoá)", async () => {
    const out = (await fill())({ number: f("A"), khong_co: f("x") });
    expect(Object.keys(out)).toHaveLength(23);
    expect("khong_co" in out).toBe(false);
  });
  it("HD-FR-02 · khoá có đủ bốn thuộc tính; thiếu thuộc tính con ⇒ điền mặc định (quote '', verified/edited false)", async () => {
    const out = (await fill())({ total_value: { value: 500 } });
    expect(out.total_value).toEqual({ value: 500, quote: "", verified: false, edited: false });
  });
  it("HD-FR-02 · không đổi đầu vào (thuần)", async () => {
    const raw = deepFreeze({ number: f("A") });
    const out = (await fill())(raw);
    expect(raw).toEqual({ number: f("A") });
    expect(out.number).toEqual(f("A"));
  });
});

describe("HD-BR-01 · HD-AC08 · mergeFields — giữ giá trị sửa tay khi trích lại", () => {
  it("HD-AC08 · old {number:{edited:true,value:'A'}}, new {number:{value:'B'}} ⇒ 'A'", async () => {
    const m = await merge();
    const out = m({ number: { edited: true, value: "A" } }, { number: { value: "B" } });
    expect(out.number?.value).toBe("A");
    expect(out.number?.edited).toBe(true);
  });
  it("HD-AC08 · khoá không edited ⇒ lấy new (cả value, quote, verified)", async () => {
    const m = await merge();
    const out = m(
      { title: f("T0", { quote: "q0" }) },
      { title: f("T1", { quote: "q1", verified: true }) },
    );
    expect(out.title).toEqual(f("T1", { quote: "q1", verified: true }));
  });
  it("HD-BR-01 · trộn đủ 23 khoá: khoá edited giữ old nguyên bản (kể cả quote), còn lại new", async () => {
    const fillFields = await fill();
    const old = fillFields({
      number: f("A", { edited: true, quote: "tay", verified: true }),
      total_value: f(1000, { edited: true, verified: true }),
      title: f("cũ"),
    });
    const next = fillFields({
      number: f("B"),
      total_value: f(2000),
      title: f("mới"),
      buyer_name: f("ABC"),
    });
    const out = (await merge())(old, next);
    expect(out.number).toEqual(f("A", { edited: true, quote: "tay", verified: true }));
    expect(out.total_value).toEqual(f(1000, { edited: true, verified: true }));
    expect(out.title).toEqual(f("mới"));
    expect(out.buyer_name).toEqual(f("ABC"));
    expect(Object.keys(out)).toHaveLength(23);
  });
  it("HD-BR-01 · old edited nhưng value null (xoá tay) vẫn thắng new", async () => {
    const out = (await merge())({ penalty: f(null, { edited: true }) }, { penalty: f("5%") });
    expect(out.penalty?.value).toBeNull();
    expect(out.penalty?.edited).toBe(true);
  });
  it("HD-BR-01 · thuần: không đổi old/new (đóng băng sâu không ném), kết quả không dùng chung tham chiếu với old", async () => {
    const m = await merge();
    const old = deepFreeze({ number: f("A", { edited: true }) });
    const next = deepFreeze({ number: f("B") });
    const out = m(old, next);
    expect(out.number?.value).toBe("A");
    expect(old.number.value).toBe("A");
    expect(next.number.value).toBe("B");
  });
});

describe("HD-AC06 · applyEdits — sửa tay (manual.py:16)", () => {
  const base = async () =>
    (await fill())({
      total_value: f(500_000_000, { quote: "Điều 5: 500 triệu", verified: true }),
      number: f("HD-1"),
      notice_days: f(30),
    });
  it("HD-AC06 · đặt {value mới, quote GIỮ, verified:true, edited:true}; changes có khoá + cũ + mới", async () => {
    const out = (await apply())(await base(), { total_value: 750_000_000 });
    expect(out.fields.total_value).toEqual({
      value: 750_000_000,
      quote: "Điều 5: 500 triệu",
      verified: true,
      edited: true,
    });
    expect(out.changes).toEqual([{ key: "total_value", old: 500_000_000, new: 750_000_000 }]);
  });
  it("HD-AC06 · khoá không sửa giữ nguyên (cả cờ edited false)", async () => {
    const old = await base();
    const out = (await apply())(old, { total_value: 1 });
    expect(out.fields.number).toEqual(old.number);
    expect(out.fields.notice_days).toEqual(old.notice_days);
    expect(Object.keys(out.fields)).toHaveLength(23);
  });
  it("HD-AC06 · giá trị y cũ ⇒ KHÔNG vào changes và khoá không đổi (không bật edited)", async () => {
    const old = await base();
    const out = (await apply())(old, { number: "HD-1", notice_days: 30 });
    expect(out.changes).toEqual([]);
    expect(out.fields).toEqual(old);
  });
  it("HD-AC06 · nhiều khoá: changes có đúng các khoá thật sự đổi (bỏ khoá y cũ)", async () => {
    const out = (await apply())(await base(), { number: "HD-2", notice_days: 30, total_value: 1 });
    expect(out.changes.map((c) => c.key).sort()).toEqual(["number", "total_value"]);
    expect(out.changes.find((c) => c.key === "number")).toEqual({
      key: "number",
      old: "HD-1",
      new: "HD-2",
    });
  });
  it("HD-AC06 · xoá giá trị (null) cũng là một thay đổi: value null, edited true", async () => {
    const out = (await apply())(await base(), { notice_days: null });
    expect(out.fields.notice_days?.value).toBeNull();
    expect(out.fields.notice_days?.edited).toBe(true);
    expect(out.changes).toEqual([{ key: "notice_days", old: 30, new: null }]);
  });
  it("HD-AC06 · thuần: không đổi old (đóng băng sâu)", async () => {
    const old = deepFreeze(await base());
    const out = (await apply())(old, { total_value: 9 });
    expect(old.total_value?.value).toBe(500_000_000);
    expect(out.fields.total_value?.value).toBe(9);
  });
});
