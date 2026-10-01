// ADM-FR-13, ADM-FR-15 · AC-A05 · nhóm DependencyList và tóm tắt "n command · m agent".
import { describe, expect, test } from "bun:test";
import { usageSections, usageSummary } from "./usage";

const t = (key: string, p?: Record<string, string | number>) =>
  p
    ? `${key}:${Object.entries(p)
        .map(([k, v]) => `${k}=${v}`)
        .join(",")}`
    : key;

describe("ADM-FR-15 · usageSections", () => {
  test("command là link /commands/<id> có chữ /tên; command tắt có badge", () => {
    const [cmd] = usageSections(
      t,
      [
        { id: "c1", name: "dich", enabled: true },
        { id: "c2", name: "tr-nhanh", enabled: false },
      ],
      [],
    );
    expect(cmd?.items[0]).toMatchObject({ label: "/dich", href: "/commands/c1", mono: true });
    expect(cmd?.items[0]?.badge).toBeUndefined();
    expect(cmd?.items[1]?.badge).toEqual({ tone: "off", text: "common.off" });
  });

  test("agent chỉ hiện 6 ký tự cuối id, không link", () => {
    const [, agents] = usageSections(t, [], [{ id: "01900000-0000-7000-8000-0000000002a1" }]);
    expect(agents?.items[0]?.label).toBe("workflows.usage.agent:id=0002a1");
    expect(agents?.items[0]?.href).toBeUndefined();
  });
});

describe("ADM-FR-15 · usageSummary", () => {
  test("ghép hai nhóm, bỏ nhóm bằng 0", () => {
    expect(usageSummary(t, 2, 1)).toBe(
      "workflows.usage.commands:count=2 · workflows.usage.agents:count=1",
    );
    expect(usageSummary(t, 0, 3)).toBe("workflows.usage.agents:count=3");
    expect(usageSummary(t, 0, 0)).toBe("");
  });
});
