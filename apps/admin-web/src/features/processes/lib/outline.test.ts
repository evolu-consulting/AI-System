// CR-127 · U1 · outline.ts round-trip trên mẫu Thư viện thật (hub-api seed) + ca Unsupported có lý do. Không DB, không mạng.
import { describe, expect, test } from "bun:test";
import type { ProcessStageDef } from "@ai/contracts/hub-admin";
import { buildShowcaseDef } from "../../../../../../tools/scripts/src/seed-flow-showcase.build";
import { contractsIntakeStages } from "../../../../../hub-api/src/modules/processes/library/contracts-intake.def";
import { COMMUNITY_FLOW_TEMPLATE } from "../../../../../hub-api/src/modules/processes/library/flow-templates.community";
import {
  PURCHASE_PARENT,
  PURCHASE_TEMPLATES,
} from "../../../../../hub-api/src/modules/processes/library/purchase-templates";
import { FLOW_TEMPLATES, RECEIVE_TEMPLATES } from "./__fixtures__/flow-fixtures";
import {
  isUnsupported,
  type Outline,
  outlineNodes,
  outlineToStages,
  stagesToOutline,
  walkOutline,
} from "./outline";
import { withDefaultEnds } from "./outline-ends";

type Obj = Record<string, unknown>;
const asStages = (xs: unknown[]): ProcessStageDef[] => xs as ProcessStageDef[];

const SAMPLES: { name: string; stages: ProcessStageDef[]; exact: boolean }[] = [
  ...FLOW_TEMPLATES.map((t) => ({
    name: `Thư viện · ${t.name}`,
    stages: t.stages() as ProcessStageDef[],
    exact: true,
  })),
  ...RECEIVE_TEMPLATES.map((t) => ({
    name: `Thư viện · ${t.name}`,
    stages: t.stages() as ProcessStageDef[],
    exact: true,
  })),
  {
    name: "Thư viện · Quản trị duyệt bài",
    stages: COMMUNITY_FLOW_TEMPLATE.stages() as ProcessStageDef[],
    exact: true,
  },
  ...PURCHASE_TEMPLATES.map((t) => ({
    name: `Mua hàng · ${t.name}`,
    stages: asStages(t.stages),
    exact: false,
  })),
  { name: "Mua hàng · cha", stages: asStages(PURCHASE_PARENT.stages), exact: false },
  {
    name: "Nhập HĐ (def cũ, có Chưa đạt quay lại)",
    stages: contractsIntakeStages() as ProcessStageDef[],
    exact: false,
  },
];

// ── dạng chuẩn theo MÃ bước: so hai def cùng nghĩa dù đánh số khác (thứ tự mảng không quan trọng) ─────────────────────────────────
function canon(stages: readonly ProcessStageDef[]): Obj[] {
  const steps = stages.map((s, i) => (s.step ?? i) as number);
  const key = (n: unknown): unknown => stages[steps.indexOf(n as number)]?.key ?? `?${String(n)}`;
  const gotos = (xs: unknown) => (xs as Obj[]).map((b) => ({ ...b, goto_step: key(b.goto_step) }));
  const canonExec = (e: Obj, own: number) => {
    if (e.kind === "if") {
      e.then_step = key(e.then_step);
      e.else_step = key(e.else_step ?? own + 1);
    }
    for (const f of ["reject_step", "return_step"]) if (typeof e[f] === "number") e[f] = key(e[f]);
    if (Array.isArray(e.branches)) e.branches = gotos(e.branches);
    if (Array.isArray(e.values))
      e.values = (e.values as Obj[]).map((v) => {
        const f = v.from as Obj | undefined;
        return f?.kind === "field" ? { ...v, from: { ...f, step: key(f.step) } } : v;
      });
  };
  return stages
    .map((s, i) => {
      const c = structuredClone(s) as unknown as Obj;
      const a = c.after as Obj;
      const own = steps[i] as number;
      delete c.step;
      if (c.next_step === own + 1) delete c.next_step;
      if (c.next_step !== undefined) c.next_step = key(c.next_step);
      canonExec(c.executor as Obj, own);
      if (Array.isArray(a.branch)) a.branch = gotos(a.branch);
      if (Array.isArray(a.back_to_steps)) a.back_to_steps = a.back_to_steps.map(key);
      return c;
    })
    .sort((x, y) => String(x.key).localeCompare(String(y.key)));
}

function toOutline(stages: ProcessStageDef[]): Outline {
  const r = stagesToOutline(stages);
  if (isUnsupported(r)) throw new Error(`Unsupported: ${r.code} — ${r.reason}`);
  return r;
}

describe("round-trip trên mẫu Thư viện", () => {
  for (const s of SAMPLES) {
    test(`${s.name}: stages không đổi (cùng nghĩa${s.exact ? ", đúng từng byte" : ""})`, () => {
      const o = toOutline(s.stages);
      const back = outlineToStages(o);
      expect(canon(back)).toEqual(canon(s.stages));
      if (s.exact) expect(back).toEqual(s.stages);
      // idempotent: mở lại bản vừa lưu ra đúng cây cũ
      expect(stagesToOutline(back)).toEqual(o);
      // không làm hỏng bản gốc
      expect(back).not.toBe(s.stages);
    });
  }

  test("mọi stage đều có mặt đúng một lần trong cây (không mất, không nhân đôi)", () => {
    for (const s of SAMPLES) {
      const keys = outlineNodes(toOutline(s.stages)).map((n) => n.stage.key);
      expect(keys.slice().sort()).toEqual(s.stages.map((x) => x.key).sort());
    }
  });
});

describe("hình dạng cây", () => {
  const byKey = (k: string) =>
    FLOW_TEMPLATES.find((t) => t.key === k)?.stages() as ProcessStageDef[];

  test("Duyệt theo giá trị: Bắt đầu → Nếu {Đúng: Pháp chế, Sai: Kế toán} → Ký số → chờ ký → Hoàn tất; Từ chối / Trả lại ngoài đường chính", () => {
    const o = toOutline(byKey("hd-duyet-theo-gia-tri"));
    expect(o.items.map((n) => `${n.kind}:${n.stage.key}`)).toEqual([
      "if:re-nhanh",
      "step:ky-so",
      "step:cho-ky",
      "end:ket-thuc-approved",
    ]);
    const iff = o.items[0];
    if (iff?.kind !== "if") throw new Error("phải là Nếu");
    expect(iff.yes.map((n) => n.stage.key)).toEqual(["phap-che"]);
    expect(iff.no.map((n) => n.stage.key)).toEqual(["ke-toan"]);
    expect(o.exits.map((n) => n.stage.outcome)).toEqual(["rejected", "returned"]);
  });

  test("đích Từ chối / Trả lại / hết hạn chờ là MÃ node Kết thúc, không còn số bước", () => {
    const o = toOutline(byKey("hd-duyet-2-cap"));
    const ap = o.items[0];
    expect(ap?.refs.reject).toBe("ket-thuc-rejected");
    expect(ap?.refs.ret).toBe("ket-thuc-returned");
    expect(o.items[3]?.refs.branches).toEqual([
      "ket-thuc-rejected",
      "ket-thuc-rejected",
      "ket-thuc-rejected",
    ]);
  });

  test("stage trong cây không mang step/next_step (cây quyết định)", () => {
    for (const n of outlineNodes(toOutline(byKey("hd-duyet-theo-gia-tri")))) {
      expect(n.stage.step).toBeUndefined();
      expect(n.stage.next_step).toBeUndefined();
    }
  });
});

describe("sửa cây rồi lưu lại", () => {
  const def = () => FLOW_TEMPLATES[1]?.stages() as ProcessStageDef[]; // Duyệt theo giá trị

  test("chèn một bước vào nhánh Đúng: số bước, Nếu, next_step và Từ chối / Trả lại được đánh lại đúng", () => {
    const o = toOutline(def());
    const iff = o.items[0];
    if (iff?.kind !== "if") throw new Error("phải là Nếu");
    const extra = structuredClone(iff.yes[0]) as NonNullable<(typeof iff.yes)[0]>;
    extra.stage.key = "giam-doc";
    extra.stage.name = "Giám đốc duyệt";
    iff.yes.push(extra);
    const out = outlineToStages(o);
    const at = (k: string) => out.find((s) => s.key === k) as ProcessStageDef;
    expect(out.map((s) => s.step)).toEqual(out.map((_, i) => i));
    expect(out.map((s) => s.key)).toEqual([
      "re-nhanh",
      "phap-che",
      "giam-doc",
      "ke-toan",
      "ky-so",
      "cho-ky",
      "ket-thuc-approved",
      "ket-thuc-rejected",
      "ket-thuc-returned",
    ]);
    const e = at("re-nhanh").executor as { then_step: number; else_step: number };
    expect([e.then_step, e.else_step]).toEqual([1, 3]);
    // cuối mỗi nhánh nhảy về điểm nhập lại (Ký số), bước giữa nhánh đi tiếp mặc định
    expect(at("phap-che").next_step).toBeUndefined();
    expect(at("giam-doc").next_step).toBe(4);
    expect(at("ke-toan").next_step).toBe(4);
    const ap = at("giam-doc").executor as { reject_step: number; return_step: number };
    expect([ap.reject_step, ap.return_step]).toEqual([7, 8]);
    const wait = at("cho-ky").executor as { branches: { goto_step: number }[] };
    expect(wait.branches.map((b) => b.goto_step)).toEqual([7, 7, 7]);
    expect(stagesToOutline(out).kind).toBe("outline");
  });

  test("xoá node Kết thúc · Từ chối: Từ chối thành null, mục rẽ nhánh tới nó bị bỏ", () => {
    const o = toOutline(def());
    o.exits = o.exits.filter((x) => x.stage.outcome !== "rejected");
    const out = outlineToStages(o);
    const ap = out.find((s) => s.key === "phap-che")?.executor as { reject_step: number | null };
    expect(ap.reject_step).toBeNull();
    const wait = out.find((s) => s.key === "cho-ky")?.executor as { branches: unknown[] };
    expect(wait.branches).toEqual([]);
  });

  test("bản sao: sửa kết quả không đổi cây, và ngược lại", () => {
    const o = toOutline(def());
    const a = outlineToStages(o);
    (a[0] as { name: string }).name = "đã đổi";
    expect(outlineToStages(o)[0]?.name).not.toBe("đã đổi");
  });
});

describe("withDefaultEnds", () => {
  const draft = (): ProcessStageDef[] => {
    const full = FLOW_TEMPLATES[0]?.stages() as ProcessStageDef[]; // 2 cấp
    return full.filter((s) => s.outcome === undefined);
  };

  test("thiếu mọi Kết thúc: Hoàn tất cuối đường chính + Từ chối / Trả lại cho node Duyệt chưa có đích", () => {
    const raw = draft().map((s) => {
      const c = structuredClone(s);
      const e = c.executor as {
        reject_step?: number | null;
        return_step?: number | null;
        branches?: unknown[];
        kind: string;
      };
      if (e.kind === "approve") {
        e.reject_step = null;
        e.return_step = null;
      }
      if (e.branches) e.branches = [];
      return c;
    });
    const o = withDefaultEnds(toOutline(raw));
    expect(o.items.at(-1)?.stage.outcome).toBe("approved");
    expect(o.exits.map((x) => x.stage.outcome)).toEqual(["rejected", "returned"]);
    const out = outlineToStages(o);
    expect(out.map((s) => s.outcome).filter(Boolean)).toEqual(["approved", "rejected", "returned"]);
    const first = out[0]?.executor as { reject_step: number };
    expect(first.reject_step).toBe(out.findIndex((s) => s.outcome === "rejected"));
    expect(withDefaultEnds(o)).toEqual(o); // chạy lại không đổi
  });

  test("mẫu đã đủ Kết thúc: giữ nguyên", () => {
    const o = toOutline(FLOW_TEMPLATES[0]?.stages() as ProcessStageDef[]);
    expect(withDefaultEnds(o)).toEqual(o);
  });
});

// ── Unsupported ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
describe("Unsupported kèm lý do", () => {
  const base = FLOW_TEMPLATES[1]?.stages() as ProcessStageDef[]; // 0 Nếu · 1 Pháp chế · 2 Kế toán · 3 Ký số · 4 Chờ ký · 5-7 Kết thúc
  const edit = (f: (xs: ProcessStageDef[]) => void): ProcessStageDef[] => {
    const xs = structuredClone(base);
    f(xs);
    return xs;
  };
  const why = (stages: ProcessStageDef[]) => {
    const r = stagesToOutline(stages);
    if (!isUnsupported(r)) throw new Error("đáng lẽ Unsupported");
    expect(r.reason.length).toBeGreaterThan(10);
    return r;
  };

  test("rỗng", () => expect(why([]).code).toBe("empty"));

  test("hai bước cùng một số bước (chạy song song)", () => {
    const r = why(
      edit((xs) => {
        (xs[2] as ProcessStageDef).step = 1;
      }),
    );
    expect(r.code).toBe("parallel_steps");
  });

  test("trùng mã bước", () => {
    expect(
      why(
        edit((xs) => {
          (xs[2] as ProcessStageDef).key = "phap-che";
        }),
      ).code,
    ).toBe("duplicate_key");
  });

  test("Từ chối nhảy tới bước thường (không phải Kết thúc) ⇒ cạnh tự do, nêu mã bước", () => {
    const r = why(
      edit((xs) => {
        (xs[1]?.executor as { reject_step: number }).reject_step = 3;
      }),
    );
    expect(r.code).toBe("free_edge");
    expect(r.stageKey).toBe("phap-che");
    expect(r.reason).toContain("Pháp chế duyệt");
  });

  test("next_step trỏ ngược / ra ngoài", () => {
    expect(
      why(
        edit((xs) => {
          (xs[1] as ProcessStageDef).next_step = 1;
        }),
      ).code,
    ).toBe("bad_target");
    expect(
      why(
        edit((xs) => {
          (xs[1] as ProcessStageDef).next_step = 99;
        }),
      ).code,
    ).toBe("bad_target");
  });

  test("bước không nối từ Bắt đầu (mồ côi) ⇒ orphan", () => {
    const r = why(
      edit((xs) => {
        (xs[0]?.executor as { then_step: number }).then_step = 2;
        (xs[0]?.executor as { else_step: number }).else_step = 2;
      }),
    );
    expect(r.code).toBe("orphan");
    expect(r.stageKey).toBe("phap-che");
  });

  test("đích Từ chối không tồn tại", () => {
    expect(
      why(
        edit((xs) => {
          (xs[1]?.executor as { reject_step: number }).reject_step = 42;
        }),
      ).code,
    ).toBe("bad_target");
  });
});

describe("flow seed demo", () => {
  test("«Duyệt đề nghị chi (mẫu)» có Pháp chế + Kế toán duyệt song song cùng một bước ⇒ chỉ xem, nêu tên bước", () => {
    const def = buildShowcaseDef({ legal: "a", accounting: "b", director: "c" });
    const r = stagesToOutline(def.stages as unknown as ProcessStageDef[]);
    if (!isUnsupported(r)) throw new Error("đáng lẽ Unsupported");
    expect(r.code).toBe("parallel_steps");
    expect(r.reason).toContain("sơ đồ trống");
  });
});

describe("Nếu lồng nhau và không nhập lại", () => {
  const mk = (key: string, step: number, over: Obj = {}): ProcessStageDef =>
    ({
      key,
      name: key,
      step,
      instruction: "",
      real_action: false,
      answerer: { kind: "starter" },
      timeout_s: 60,
      token_budget: null,
      sources: [],
      must_know: [],
      autofix: null,
      output: { filename: `${key}.md`, template: "x", required_sections: ["x"], fields: [] },
      executor: {
        kind: "notify",
        to: [{ who: "starter" }],
        channels: ["bell"],
        title: "t",
        body: "b",
      },
      after: { kind: "auto", branch: [] },
      ...over,
    }) as unknown as ProcessStageDef;
  const iff = (key: string, step: number, then: number, otherwise: number | null) =>
    mk(key, step, {
      executor: {
        kind: "if",
        when: { op: "and", conds: [] },
        then_step: then,
        else_step: otherwise,
      },
    });
  const end = (key: string, step: number, outcome: string) =>
    mk(key, step, { outcome, executor: { kind: "set", values: [] } });

  test("Nếu lồng trong nhánh Đúng, else_step null = bước kế", () => {
    // 0 Nếu(Đúng→1, Sai→5) · 1 Nếu(Đúng→2, Sai→null=2…)  dựng: 0 If a→1 / →4 ; 1 If b→2 / →3 ; 2 X (next 3) ; 3 Y (next 4) ; 4 Z ; 5 end
    const xs = [
      iff("a", 0, 1, 4),
      iff("b", 1, 2, 3),
      mk("x", 2, { next_step: 3 }),
      mk("y", 3, { next_step: 5 }),
      mk("z", 4, { next_step: 5 }),
      end("fin", 5, "approved"),
    ];
    const o = toOutline(xs);
    expect(o.items.map((n) => n.stage.key)).toEqual(["a", "fin"]);
    const a = o.items[0];
    if (a?.kind !== "if") throw new Error("Nếu");
    expect(a.yes.map((n) => n.stage.key)).toEqual(["b", "y"]);
    expect(a.no.map((n) => n.stage.key)).toEqual(["z"]);
    const b = a.yes[0];
    if (b?.kind !== "if") throw new Error("Nếu lồng");
    expect(b.yes.map((n) => n.stage.key)).toEqual(["x"]);
    expect(b.no).toEqual([]);
    const back = outlineToStages(o);
    expect(canon(back)).toEqual(canon(xs));
    expect(stagesToOutline(back)).toEqual(o);
  });

  test("hai nhánh Nếu đều kết thúc riêng (không nhập lại): cây đủ, về lại đúng", () => {
    const xs = [iff("a", 0, 1, 2), end("ok", 1, "approved"), end("no", 2, "rejected")];
    const o = toOutline(xs);
    const a = o.items[0];
    if (a?.kind !== "if") throw new Error("Nếu");
    expect(a.yes.map((n) => n.stage.key)).toEqual(["ok"]);
    expect(a.no.map((n) => n.stage.key)).toEqual(["no"]);
    expect(o.exits).toEqual([]);
    expect(outlineToStages(o)).toEqual(xs.map((s) => ({ ...s }))); // exact
  });

  test("nhánh Nếu đi vào giữa nhánh khác (không lồng gọn được) ⇒ Unsupported rejoin", () => {
    // 0 Nếu(1|2) · 1 Nếu(2|3) · 2 X · 3 Y(next 4) · 4 fin: bước 2 vừa là nhánh Đúng lồng, vừa là nhánh Sai ngoài
    const xs = [
      iff("a", 0, 1, 2),
      iff("b", 1, 2, 3),
      mk("x", 2),
      mk("y", 3, { next_step: 4 }),
      end("fin", 4, "approved"),
    ];
    const r = stagesToOutline(xs);
    if (!isUnsupported(r)) throw new Error("đáng lẽ Unsupported");
    expect(r.code).toBe("rejoin");
    expect(r.reason.length).toBeGreaterThan(10);
  });

  test("walkOutline đi đủ mọi node theo thứ tự đọc", () => {
    const xs = [
      iff("a", 0, 1, 2),
      mk("p", 1, { next_step: 3 }),
      mk("q", 2, { next_step: 3 }),
      end("fin", 3, "approved"),
    ];
    const seen: string[] = [];
    walkOutline(toOutline(xs).items, (n) => seen.push(n.stage.key));
    expect(seen).toEqual(["a", "p", "q", "fin"]);
  });
});
