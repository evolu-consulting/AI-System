// CR-123 · u3a · FLOW3-FR-14 · luật cụm node module (Ký số = gửi + chờ): phát hiện cụm, từ chối tách / thiếu / đảo / stage lạ chen giữa.
import { describe, expect, test } from "bun:test";
import {
  clusterIssueMessage,
  clusterOf,
  moduleClusterIssues,
  moduleClusters,
} from "./process-module-nodes";

const send = { node: "contracts.esign", executor: { kind: "tool" } };
const wait = { node: "contracts.esign", executor: { kind: "wait_event" } };
const other = { executor: { kind: "set" } };
const mail = { node: "core.email", executor: { kind: "notify" } };

describe("moduleClusters / clusterOf", () => {
  test("gửi + chờ liên tiếp = một cụm; stage khác không thuộc cụm nào", () => {
    const st = [other, send, wait, mail];
    expect(moduleClusters(st)).toEqual([{ node: "contracts.esign", start: 1, end: 3 }]);
    expect(clusterOf(st, 1)?.end).toBe(3);
    expect(clusterOf(st, 2)?.start).toBe(1);
    expect(clusterOf(st, 0)).toBeNull();
    expect(clusterOf(st, 3)).toBeNull(); // node một stage không là cụm
  });
  test("hai node Ký số liền nhau = hai cụm", () => {
    const st = [send, wait, send, wait];
    expect(moduleClusters(st).map((c) => [c.start, c.end])).toEqual([
      [0, 2],
      [2, 4],
    ]);
    expect(moduleClusterIssues(st)).toEqual([]);
  });
  test("stage nháp FE (executor là chuỗi) cũng đọc được", () => {
    const st = [
      { node: "contracts.esign", executor: "tool" },
      { node: "contracts.esign", executor: "wait_event" },
    ];
    expect(moduleClusters(st)).toHaveLength(1);
  });
});

describe("moduleClusterIssues", () => {
  test("hợp lệ / không có node module ⇒ rỗng", () => {
    expect(moduleClusterIssues([other, send, wait, other])).toEqual([]);
    expect(moduleClusterIssues([other, mail])).toEqual([]);
  });
  test("stage lạ chen giữa ⇒ split, chỉ rõ bước + câu nghiệp vụ", () => {
    const [i] = moduleClusterIssues([send, other, wait]);
    expect(i).toMatchObject({ node: "contracts.esign", label: "Ký số", rule: "split", index: 0 });
    expect(clusterIssueMessage(i as never)).toBe(
      "Bước Ký số bị tách rời — xoá rồi thêm lại bước Ký số",
    );
  });
  test("thiếu một nửa ⇒ incomplete", () => {
    expect(moduleClusterIssues([send])[0]?.rule).toBe("incomplete");
    expect(moduleClusterIssues([other, wait])[0]?.rule).toBe("incomplete");
  });
  test("đảo thứ tự (chờ trước gửi) ⇒ reordered", () => {
    expect(moduleClusterIssues([wait, send])[0]?.rule).toBe("reordered");
  });
  test("cụm đủ + một stage thừa liền sau ⇒ incomplete ở stage thừa", () => {
    const [i] = moduleClusterIssues([send, wait, send]);
    expect(i).toMatchObject({ rule: "incomplete", index: 2 });
  });
});
