// CR-056 · P-a thread §6 #6: `useFlowKind` — cache timeline có khối gốc thì không cần tải thread.
import { describe, expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { roomKeys } from "../lib/room-cache";
import { type FlowKind, useFlowKind } from "./use-flow-kind";

const ROOM = "00000000-0000-4000-8000-000000000001";
const FLOW = "00000000-0000-4000-8000-000000000002";

function kindOf(senderType: "agent" | "process" | "user" | null): FlowKind {
  const client = new QueryClient();
  if (senderType) {
    client.setQueryData(roomKeys.messages(ROOM), {
      pages: [{ items: [{ id: "m", seq: 1, flow_id: FLOW, sender_type: senderType }] }],
      pageParams: [undefined],
    });
  }
  let out: FlowKind = "loading";
  function Probe() {
    out = useFlowKind(ROOM, FLOW);
    return null;
  }
  renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
  return out;
}

describe("useFlowKind", () => {
  test("khối gốc process ⇒ process; agent ⇒ agent; user (tin gọi) ⇒ agent", () => {
    expect(kindOf("process")).toBe("process");
    expect(kindOf("agent")).toBe("agent");
    expect(kindOf("user")).toBe("agent");
  });
  test("chưa có gì trong cache ⇒ loading", () => {
    expect(kindOf(null)).toBe("loading");
  });
  test("tin gọi (user) đứng trước + khối process cùng flow ⇒ process (F2)", () => {
    const client = new QueryClient();
    client.setQueryData(roomKeys.messages(ROOM), {
      pages: [
        {
          items: [
            { id: "call", seq: 1, flow_id: FLOW, sender_type: "user" },
            { id: "block", seq: 2, flow_id: FLOW, sender_type: "process" },
          ],
        },
      ],
      pageParams: [undefined],
    });
    let out = "loading" as FlowKind;
    function Probe() {
      out = useFlowKind(ROOM, FLOW);
      return null;
    }
    renderToString(createElement(QueryClientProvider, { client }, createElement(Probe)));
    expect(out).toBe("process");
  });
});
