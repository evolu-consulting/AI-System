// CR-122 · A2 · luật thuần của 3 sự kiện Community: khoá ổn định, dữ kiện khớp manifest, outcome ⇒ trạng thái.
import { describe, expect, it } from "bun:test";
import { COMMUNITY_MANIFEST as communityManifest } from "@ai/contracts/app-manifest";
import {
  COMMUNITY_EVENTS,
  EV_JOIN,
  EV_POST,
  EV_REPORT,
  eventIdOf,
  joinFacts,
  joinTarget,
  postFacts,
  postTarget,
  reportFacts,
  reportTarget,
} from "./flow-events.rules";

const decl = (k: string) => communityManifest.events.find((e) => e.key === k);

describe("flow-events.rules [CR-122 A2]", () => {
  it("event_id ổn định theo bản ghi", () => {
    expect(eventIdOf(EV_POST, "p1")).toBe("post.created:p1");
    expect(eventIdOf(EV_POST, "p1")).toBe(eventIdOf(EV_POST, "p1"));
    expect(eventIdOf(EV_JOIN, "p1")).not.toBe(eventIdOf(EV_POST, "p1"));
  });

  it("dữ kiện đúng khoá đã khai trong manifest; cả ba sự kiện decides", () => {
    const facts: Record<string, string[]> = {
      [EV_POST]: Object.keys(postFacts({ type: "sell", author_org: null })),
      [EV_JOIN]: Object.keys(joinFacts({ company: "A", email: "a@b.c" })),
      [EV_REPORT]: Object.keys(reportFacts({ triage_kind: null, triage_level: null })),
    };
    for (const e of COMMUNITY_EVENTS) {
      expect(decl(e)?.decides).toBe(true);
      expect([...(facts[e] ?? [])].sort()).toEqual(
        decl(e)
          ?.facts.map((f) => f.key)
          .sort() ?? [],
      );
    }
    expect(postFacts({ type: "buy", author_org: "o1" })).toEqual({
      post_kind: "buy",
      author_is_partner: true,
    });
    expect(postFacts({ type: "note", author_org: null }).author_is_partner).toBe(false);
  });

  it("outcome ⇒ trạng thái bản ghi; mọi outcome khai trong manifest đều có đích", () => {
    expect(postTarget("shown")).toBe("approved");
    expect(postTarget("hidden")).toBe("rejected");
    expect(joinTarget("accepted")).toBe("approved");
    expect(joinTarget("rejected")).toBe("rejected");
    expect(reportTarget("hidden")).toBe("hide");
    expect(reportTarget("kept")).toBe("dismiss");
    expect(reportTarget("warned")).toBe("warn");
    expect(postTarget("x")).toBeNull();
    const by = { [EV_POST]: postTarget, [EV_JOIN]: joinTarget, [EV_REPORT]: reportTarget };
    for (const e of COMMUNITY_EVENTS)
      for (const o of decl(e)?.outcomes ?? []) expect(by[e](o.key)).not.toBeNull();
  });
});
