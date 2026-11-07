// CR-124 · q1 · NFR-02 · khoá sự kiện hộp thư: một mailbox ⇒ đúng một event_id mỗi chiều, tên sự kiện khớp node chờ.
import { describe, expect, it } from "bun:test";
import {
  PARTNER_OUTCOMES,
  RECEIVED_EVENT,
  receivedEventId,
  replyEventId,
  replyEventOf,
} from "./mailbox-events.rules";

const EVENT_RE = /^[a-z][a-z0-9_-]{0,39}\.[a-z][a-z0-9_-]{0,39}$/; // = flow_events_event_ck (hub 0105)

describe("CR-124 q1 · khoá sự kiện hộp thư", () => {
  it("tên sự kiện hợp lệ theo ràng buộc flow_events", () => {
    expect(EVENT_RE.test(RECEIVED_EVENT)).toBe(true);
    expect(PARTNER_OUTCOMES.map(replyEventOf)).toEqual([
      "partner.confirmed",
      "partner.returned",
      "partner.declined",
    ]);
    for (const o of PARTNER_OUTCOMES) expect(EVENT_RE.test(replyEventOf(o))).toBe(true);
  });

  it("event_id ổn định theo mailbox.id, hai chiều khác nhau", () => {
    const id = "6f1c0d3e-0000-4000-8000-000000000001";
    expect(receivedEventId(id)).toBe(receivedEventId(id));
    expect(receivedEventId(id)).not.toBe(replyEventId(id));
    expect(replyEventId(id).length).toBeLessThanOrEqual(200);
  });
});
