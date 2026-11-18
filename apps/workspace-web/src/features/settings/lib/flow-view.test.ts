// CR-184 · nhãn bước Ký theo «Ký qua», chữ trên sơ đồ, danh sách đi theo thứ tự sơ đồ và ghi rõ nhánh.
import { beforeAll, describe, expect, test } from "bun:test";
import { i18n, initI18n } from "~/app/i18n";
import { type CurrentFlow, type CurrentGraphStage, toCurrentFlow } from "./current-flow";
import { esignLabel, listRows, viewStages, viewTrigger } from "./flow-view";

beforeAll(async () => {
  await initI18n();
  await i18n.changeLanguage("vi");
});
const t = (k: string, o?: Record<string, unknown>) => i18n.t(k, o) as string;

const g = (key: string, step: number, e: Partial<CurrentGraphStage> = {}): CurrentGraphStage => ({
  key,
  step,
  name: key,
  kind: "review",
  department: null,
  provider: null,
  after: "auto",
  backTo: [],
  branch: [],
  ifs: null,
  nextStep: null,
  terminal: false,
  ...e,
});
function flow(graph: CurrentGraphStage[]): CurrentFlow {
  const f = toCurrentFlow({
    def_id: "11111111-1111-4111-8111-111111111111",
    name: "Duyệt 2 cấp",
    rel_version: 2,
    steps: [],
    start_when: null,
  }) as CurrentFlow;
  return { ...f, graph };
}

describe("esignLabel", () => {
  test("ondoc ⇒ Ký trên tài liệu, upload ⇒ Tải lên bản đã ký, nhà cung cấp ⇒ Ký số (tên), chưa đặt ⇒ Ký số", () => {
    expect(esignLabel("ondoc", t)).toBe("Ký trên tài liệu");
    expect(esignLabel("upload", t)).toBe("Tải lên bản đã ký");
    expect(esignLabel("docusign", t)).toBe("Ký số (DocuSign)");
    expect(esignLabel(null, t)).toBe("Ký số");
  });
  test("EN theo cùng khoá", async () => {
    await i18n.changeLanguage("en");
    expect(esignLabel("ondoc", t)).toBe("Sign on the document");
    await i18n.changeLanguage("vi");
  });
});

const F = flow([
  g("Trưởng phòng duyệt", 0, { department: "Phòng KD" }),
  g("Giá trị lớn?", 1, { kind: "if", ifs: { yes: 3, no: 2 } }),
  g("Gửi đối tác", 2, { kind: "partner_send" }),
  g("Ký", 3, { kind: "esign", provider: "ondoc" }),
  g("Kết thúc", 4, { kind: "end", terminal: true }),
]);

describe("viewStages / viewTrigger", () => {
  test("bước Ký mang huy hiệu theo «Ký qua», Gửi đối tác có huy hiệu, Kết thúc là điểm cuối", () => {
    const s = viewStages(F, t);
    expect(s.find((x) => x.uid === "Ký")?.badge).toBe("Ký trên tài liệu");
    expect(s.find((x) => x.uid === "Gửi đối tác")?.badge).toBe("Gửi đối tác");
    expect(s.find((x) => x.uid === "Kết thúc")).toMatchObject({ end: true, terminal: true });
    expect(s.find((x) => x.uid === "Giá trị lớn?")?.ifs).toEqual({ yes: 3, no: 2 });
  });
  test("node Bắt đầu: «Bắt đầu» + điều kiện", () => {
    expect(viewTrigger(F, t)).toEqual({
      label: "Bắt đầu",
      summary: "Bắt đầu khi: Mọi hợp đồng còn lại",
    });
  });
});

describe("listRows", () => {
  test("cùng thứ tự theo bước, node Nếu ghi rõ Đúng ⇒ / Sai ⇒, chỉ bước thường được đánh số", () => {
    const rows = listRows(F, t);
    expect(rows.map((r) => r.title)).toEqual([
      "Trưởng phòng duyệt",
      "Giá trị lớn?",
      "Gửi đối tác",
      "Ký",
      "Kết thúc",
    ]);
    expect(rows[1]?.branches).toEqual(["Đúng ⇒ Ký", "Sai ⇒ Gửi đối tác"]);
    expect(rows.map((r) => r.index)).toEqual([1, 0, 2, 3, 0]);
    expect(rows[3]?.badge).toBe("Ký trên tài liệu");
    expect(rows[4]?.end).toBe(true);
  });
  test("mảng không theo thứ tự bước ⇒ danh sách vẫn theo bước", () => {
    const r = listRows(flow([g("b", 1), g("a", 0)]), t);
    expect(r.map((x) => x.title)).toEqual(["a", "b"]);
  });
});
