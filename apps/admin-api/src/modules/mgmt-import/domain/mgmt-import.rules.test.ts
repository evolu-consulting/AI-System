// I1 · unit luật thuần của importer mgmt-app: id tất định, tiền không làm tròn, serial, khoá nhắc, product key, luật thấy
// mgmt-app, tổng tiền nguồn, và từng mapper trên ảnh chụp nhỏ (dữ liệu GIẢ).
import { describe, expect, test } from "bun:test";
import { companyIndex } from "./companies.rules";
import type { Ctx, Snapshot } from "./context";
import { targetId, uuidV5 } from "./ids.rules";
import { mapCks } from "./map-cks.rules";
import { approvalRow, matchForm, parseRemindKey, productKey } from "./map-contracts.rules";
import { memberships, usersExport } from "./map-identity.rules";
import { mapLedger } from "./map-ledger.rules";
import { newPlan, tenantPlan } from "./plan";
import { mgmtVisible, sourceMoney } from "./reconcile.rules";
import { day, type Issue, money, serialKey, str } from "./values.rules";

const ctxOf = (issues: Issue[] = []): Ctx => ({
  source: "t",
  tenantOf: (o) => (o === "A" ? "00000000-0000-4000-8000-00000000000a" : null),
  userOf: (_t, e) => (e ? `user:${e}` : null),
  fallbackUser: () => "owner",
  knowledgeOrg: null,
  issues,
});
const snap = (docs: Snapshot["docs"]): Snapshot => ({ docs, graph: {} });
const d = (id: string, src: Record<string, unknown>) => ({ id, src });

describe("ids + giá trị", () => {
  test("uuid v5 đúng RFC (vector DNS 'www.example.com') và tất định theo (nguồn, loại, id)", () => {
    expect(uuidV5("www.example.com", "6ba7b810-9dad-11d1-80b4-00c04fd430c8")).toBe(
      "2ed6657d-e927-568b-95e1-2665a8aea6a2",
    );
    expect(targetId("s", "contract", "x")).toBe(targetId("s", "contract", "x"));
    expect(targetId("s", "contract", "x")).not.toBe(targetId("s2", "contract", "x"));
  });
  test("tiền: số nguyên đồng giữ nguyên; thập phân/âm/quá 10^15 ⇒ null + MONEY_NOT_INT (không làm tròn)", () => {
    const issues: Issue[] = [];
    expect(money(588_000_000, issues, "c", "r")).toBe(588_000_000);
    expect(money("1200", issues, "c", "r")).toBe(1200);
    expect(money(null, issues, "c", "r")).toBeNull();
    expect(money(1.5, issues, "c", "r")).toBeNull();
    expect(money(-1, issues, "c", "r")).toBeNull();
    expect(money(2e15, issues, "c", "r")).toBeNull();
    expect(issues.map((i) => i.code)).toEqual(["MONEY_NOT_INT", "MONEY_NOT_INT", "MONEY_NOT_INT"]);
  });
  test("chuỗi bỏ NUL + cắt theo code point; ngày ISO", () => {
    expect(str("a\u0000b", 10)).toBe("ab");
    expect(str("Bếp Việt", 3)).toBe("Bếp");
    expect(day("2026-02-30")).toBeNull();
    expect(day("2026-10-20T09:00:00+07:00")).toBe("2026-10-20");
  });
  test("serial ≡ norm_serial; khoá nhắc; product key ≡ mgmt", () => {
    expect(serialKey("5401 0b72 33AF 9E10")).toBe("54010B7233AF9E10");
    expect(serialKey("00FF")).toBe("FF");
    expect(parseRemindKey("remind:demo-1:2026-10-02:30:E1@x.test")).toEqual({
      contract: "demo-1",
      deadline: "2026-10-02",
      milestone: 30,
      email: "e1@x.test",
    });
    expect(parseRemindKey("remind:c:price-2026-01-01:0:e@x")).toBeNull();
    expect(matchForm(" Thịt Heo ")).toBe("thit heo");
    expect(productKey(null, "Bao bì", null, "A")).toBe("A|name:bao bi|");
    expect(productKey("SP-01", "x", null, "A")).toBe("A|code:sp-01");
  });
});

describe("identity", () => {
  test("export N5: một org mỗi user theo membership; manager_email chuyển cho N5 (M1b)", () => {
    const m = memberships([
      d("a@x", { email: "a@x", org_id: "A", role: "owner" }),
      d("b@x", { email: "B@X", org_id: "A", role: "editor", manager_email: "a@x" }),
      d("c@x", { email: "c@x", org_id: "Z", role: "viewer", manager_email: "a@x" }),
    ]);
    const ex = usersExport(
      "t",
      [d("A", { id: "A", name: "Org" })],
      [d("b@x", { email: "b@x", password_hash: "scrypt$1$2" }), d("s@x", { email: "s@x" })],
      m,
    );
    expect(ex.users).toEqual([
      {
        email: "b@x",
        name: "",
        org_id: "A",
        org_role: "editor",
        password_hash: "scrypt$1$2",
        manager_email: "a@x",
        locale: "vi",
      },
      {
        email: "s@x",
        name: "",
        org_id: null,
        org_role: null,
        password_hash: null,
        manager_email: null,
        locale: "vi",
      },
    ]);
  });
});

describe("sổ + CKS", () => {
  test("sổ: bên theo công ty (tên, MST); nguồn ngoài tập ⇒ action/manual; huỷ ⇒ hàng huỷ; thiếu ngày ⇒ vấn đề", () => {
    const issues: Issue[] = [];
    const s = snap({
      companies: [d("A|tax:0101", { org_id: "A", name: "Cty", tax_id: "0101" })],
      obligations: [
        d("o1", {
          org_id: "A",
          contract_id: "c",
          company_id: "A|tax:0101",
          direction: "pay",
          due_date: "2026-01-01",
          amount: 5,
          status: "done",
          source: "seed",
        }),
      ],
      partner_events: [
        d("e1", {
          org_id: "A",
          company_id: "A|name:xyz",
          role: "customer",
          type: "rating",
          at: "2026-01-02",
          source: "rating",
          value: 80,
          voided: true,
        }),
        d("e2", { org_id: "A", company_id: "A|tax:0101", role: "supplier", type: "delivered" }),
      ],
    });
    const p = newPlan();
    mapLedger(s, ctxOf(issues), p, companyIndex(s));
    const t = [...p.tenants.values()][0];
    expect(t?.rows["contracts.obligations"]?.[0]).toMatchObject({
      party_name: "Cty",
      party_tax: "0101",
      source: "manual",
      done_at: "2026-01-01",
    });
    expect(t?.rows["contracts.partner_events"]?.[0]).toMatchObject({
      party_name: "xyz",
      party_tax: null,
      source: "action",
      data: { value: 80 },
    });
    expect(t?.rows["contracts.partner_event_voids"]).toHaveLength(1);
    expect(issues.map((i) => i.code)).toEqual(["DONE_WITHOUT_DATE", "EVENT_INCOMPLETE"]);
  });
});

describe("CKS", () => {
  test("CKS: khách gộp theo MST; serial trùng ⇒ serial_key null; replaces trỏ chữ ký không chuyển ⇒ null; giá thị trường dùng chung vào mọi tenant", () => {
    const issues: Issue[] = [];
    const s = snap({
      companies: [d("A|tax:01", { org_id: "A", name: "K", tax_id: "01" })],
      cks_certificates: [
        d("k1", {
          org_id: "A",
          company_id: "A|tax:01",
          serial: "AB 01",
          valid_to: "2027-01-01",
          holder_name: "x",
          replaces: "gone",
        }),
        d("k2", {
          org_id: "A",
          company_id: "A|tax:01",
          serial: "ab01",
          valid_to: "2027-01-01",
          holder_name: "y",
        }),
      ],
      market_observations: [
        d("m", {
          org_id: "*",
          product_kind: "cks",
          ca: "vnpt",
          years: 1,
          seller: "S",
          price_ex_vat: 9,
          seen: "2026-01-01",
        }),
      ],
    });
    const p = newPlan();
    tenantPlan(p, "00000000-0000-4000-8000-00000000000a", "A");
    mapCks(s, ctxOf(issues), p, companyIndex(s));
    const t = [...p.tenants.values()][0];
    expect(t?.rows["contracts.cks_customers"]).toHaveLength(1);
    expect(t?.rows["contracts.cks_certificates"]?.map((c) => [c.serial_key, c.replaces])).toEqual([
      ["AB01", null],
      [null, null],
    ]);
    expect(t?.rows["contracts.cks_market_prices"]).toHaveLength(1);
    expect(issues.map((i) => i.code)).toEqual(["SERIAL_DUP"]);
  });
});

describe("đối soát", () => {
  const s = snap({
    contracts: [
      d("c1", {
        org_id: "A",
        owner_email: "boss@x",
        fields: { total_value: { value: 10 } },
        items: [{ name: "i", unit_price: 3 }],
      }),
      d("c2", { org_id: "A", owner_email: "me@x", fields: { total_value: { value: 1.5 } } }),
      d("c3", { org_id: "A", owner_email: null, created_by: "me@x" }),
      d("c4", { org_id: "A", owner_email: null, created_by: "boss@x", parent_id: "c2" }),
      d("c5", { org_id: "A", owner_email: "sub@x" }),
    ],
    market_observations: [d("m", { org_id: "*", product_kind: "cks", price_ex_vat: 7 })],
  });
  test("tổng tiền nguồn: không nguyên ⇒ 0 (lệch với đích sẽ lộ ra); giá dùng chung cộng vào mọi org", () => {
    expect(sourceMoney(s, ["A", "B"]).get("A")).toMatchObject({
      "contracts.total_value": 10n,
      "items.unit_price": 3n,
      "cks_market_prices.price_ex_vat": 7n,
    });
    expect(sourceMoney(s, ["A", "B"]).get("B")?.["cks_market_prices.price_ex_vat"]).toBe(7n);
  });
  test("luật thấy ≡ orgs.Ctx.sees: chủ thấy hết; còn lại phạm vi mình + cấp dưới, chưa giao mà mình tạo, phụ lục theo cha", () => {
    const m = memberships([
      d("boss@x", { email: "boss@x", org_id: "A", role: "owner" }),
      d("me@x", { email: "me@x", org_id: "A", role: "editor" }),
      d("sub@x", { email: "sub@x", org_id: "A", role: "viewer", manager_email: "me@x" }),
    ]);
    expect([...(mgmtVisible(s, m, "boss@x", true) ?? [])].sort()).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
    ]);
    expect([...(mgmtVisible(s, m, "me@x", true) ?? [])].sort()).toEqual(["c2", "c3", "c4", "c5"]);
    expect([...(mgmtVisible(s, m, "sub@x", true) ?? [])].sort()).toEqual(["c5"]);
    expect(mgmtVisible(s, m, "me@x", false)).toBeNull();
  });
});

describe("M3 lượt duyệt", () => {
  test("trạng thái HĐ ⇒ contracts.approvals như migration 0011_m3_approvals; người xác nhận = cấp 1 + người quyết khi done", () => {
    const c = (status: string) => ({
      id: "c",
      run_id: "r",
      status,
      created_by: "u",
      confirmed_by: "k",
      confirmed_at: "t",
    });
    expect(approvalRow(c("active"))).toMatchObject({
      id: "r",
      contract_id: "c",
      status: "done",
      level1_by: "k",
      decided_by: "k",
    });
    expect(approvalRow(c("needs_review"))).toMatchObject({
      status: "level1",
      decided_by: null,
      started_by: "u",
    });
    expect(approvalRow(c("extract_failed")).status).toBe("failed");
    expect(approvalRow(c("terminated")).status).toBe("done");
  });
});
