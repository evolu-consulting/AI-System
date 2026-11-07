// CR-124 · q3 · khai báo node «Gửi đối tác xác nhận»: khoá khớp thư mục, 4 đầu ra khớp stage chờ, cổng cấu hình hợp lệ.
import { describe, expect, test } from "bun:test";
import { PartnerSendConfigSchema, parseSendFields } from "./config";
import { PARTNER_SEND_NODE } from "./node";

describe("contracts.partner-send", () => {
  test("khoá node khớp thư mục, 2 stage: tool real_action + wait_event", () => {
    expect(PARTNER_SEND_NODE.key).toBe("contracts.partner-send");
    const [send, wait] = PARTNER_SEND_NODE.stages;
    expect(send?.executor.kind).toBe("tool");
    expect(send?.real_action).toBe(true);
    expect(wait?.executor.kind).toBe("wait_event");
  });

  test("đầu ra: mỗi khoá `on` là sự kiện của stage chờ hoặc timeout", () => {
    const wait = PARTNER_SEND_NODE.stages[1]?.executor as unknown as {
      event: string;
      also_events: string[];
    };
    const known = new Set([wait.event, ...wait.also_events, "timeout"]);
    const exits = PARTNER_SEND_NODE.exits ?? [];
    expect(exits.map((e) => e.key)).toEqual(["confirmed", "returned", "declined", "expired"]);
    for (const e of exits) for (const on of e.on ?? []) expect(known.has(on)).toBe(true);
  });

  test("cổng cấu hình: nhận giá trị hợp lệ, từ chối hạn > 30 ngày và khoá lạ", () => {
    const ok = PartnerSendConfigSchema.safeParse({
      reply_days: "7",
      send_fields: "total_value,end_date",
    });
    expect(ok.success).toBe(true);
    expect(PartnerSendConfigSchema.safeParse({ reply_days: 31 }).success).toBe(false);
    expect(parseSendFields("total_value,hack,total_value,end_date")).toEqual([
      "total_value",
      "end_date",
    ]);
  });
});
