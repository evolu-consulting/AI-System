// CR-184 · đồ thị đầy đủ của flow đang chạy: Nếu (then/else), Gửi đối tác, Kết thúc, «Ký qua»; stage rác không làm hỏng.
import { expect, it } from "bun:test";
import { graphOfStages } from "./event-flow-graph.rules";

const KY = { kind: "tool", tool_key: "contracts-esign-send" };
const stages = [
  {
    key: "duyet",
    name: "Giám đốc duyệt",
    step: 0,
    executor: { kind: "approve" },
    after: { kind: "review", group_key: "giam-doc", group_id: null, back_to_steps: [] },
  },
  {
    key: "neu",
    name: "Giá trị lớn?",
    step: 1,
    executor: { kind: "if", then_step: 3, else_step: 2 },
  },
  {
    key: "gui",
    name: "Gửi đối tác",
    step: 2,
    executor: { kind: "tool", tool_key: "contracts-partner-send" },
    next_step: 3,
  },
  {
    key: "ky",
    name: "Ký",
    step: 3,
    executor: { ...KY, args: { provider: { from: "const", value: "ondoc" } } },
  },
  { key: "cho", name: "Chờ ký xong", step: 4, executor: { kind: "wait_event" } },
  { key: "end", name: "Kết thúc", step: 5, executor: { kind: "set" }, outcome: "approved" },
];

it("giữ MỌI stage theo thứ tự mảng, đúng loại và trường dựng cạnh", () => {
  const g = graphOfStages(stages);
  expect(g.map((x) => [x.key, x.kind, x.step])).toEqual([
    ["duyet", "review", 0],
    ["neu", "if", 1],
    ["gui", "partner_send", 2],
    ["ky", "esign", 3],
    ["cho", "wait", 4],
    ["end", "end", 5],
  ]);
  expect(g[0]).toMatchObject({ groupKey: "giam-doc", after: "review" });
  expect(g[1]?.ifs).toEqual({ yes: 3, no: 2 });
  expect(g[2]?.nextStep).toBe(3);
  expect(g[3]?.provider).toBe("ondoc");
});

it("điểm cuối: Kết thúc và chờ sự kiện thường, chờ thuộc node module thì không", () => {
  const g = graphOfStages([
    ...stages,
    { key: "m", name: "m", step: 6, node: "contracts.esign", executor: { kind: "wait_event" } },
  ]);
  expect(g.filter((x) => x.terminal).map((x) => x.key)).toEqual(["cho", "end"]);
});

it("stage rác / thiếu trường không làm hỏng, số âm hoặc không nguyên bị bỏ", () => {
  const g = graphOfStages([
    null,
    "x",
    { executor: { kind: "if", then_step: -1, else_step: 1.5 }, step: 0 },
  ]);
  expect(g).toHaveLength(1);
  expect(g[0]).toMatchObject({ key: "s0", kind: "if", ifs: { yes: null, no: null } });
});
