// ADM-FR-71/72 · HUB-FR-143…145, 115 · P-d1 · T11a · luật form thuần của admin-web.
import { describe, expect, test } from "bun:test";
import {
  escalateIssueKey,
  remindIssueKey,
  ruleErrorKey,
  ttlIssueKey,
  waitIssueKey,
} from "./error-keys";
import { escalateIssues, remindIssue } from "./remind-rules";
import { ttlFromValue, ttlIssue, ttlToValue } from "./ttl-rules";
import { timeZoneOptions, utcOffsetLabel } from "./tz-format";
import {
  dateSources,
  offsetDirection,
  parseSourceValue,
  sourceValue,
  waitIssues,
} from "./wait-rules";

const inputs = [
  { key: "due", label: "Hạn", type: "date" },
  { key: "note", label: "Ghi chú", type: "text" },
];
const stages = [
  {
    key: "a",
    name: "A",
    step: 0,
    fields: [
      { key: "ship", type: "date" },
      { key: "x", type: "text" },
    ],
  },
  { key: "b", name: "B", step: 1, fields: [{ key: "later", type: "date" }] },
  { key: "c", name: "C", step: 2, fields: [{ key: "never", type: "date" }] },
];

describe("wait-rules", () => {
  test("dateSources: input date + field date ở bước nhỏ hơn", () => {
    const s = dateSources(inputs, stages, 2);
    expect(s.map(sourceValue)).toEqual(["input:due", "field:a:ship", "field:b:later"]);
    expect(dateSources(inputs, stages, 0).map(sourceValue)).toEqual(["input:due"]);
    expect(dateSources([], [], 0)).toEqual([]);
    expect(s[1]).toEqual({ kind: "field", stageKey: "a", stageName: "A", n: 1, field: "ship" });
  });
  test("sourceValue ↔ parseSourceValue", () => {
    expect(parseSourceValue("input:due")).toEqual({ kind: "input", key: "due" });
    expect(parseSourceValue("field:a:ship")).toEqual({
      kind: "field",
      stageKey: "a",
      field: "ship",
    });
    for (const bad of ["", "input:", "field:a", "field:a:", "x:y", "input:a:b"])
      expect(parseSourceValue(bad)).toBeNull();
  });
  test("offsetDirection", () => {
    expect(offsetDirection(0)).toEqual({ dir: "on", abs: 0 });
    expect(offsetDirection(-3)).toEqual({ dir: "before", abs: 3 });
    expect(offsetDirection(365)).toEqual({ dir: "after", abs: 365 });
  });
  test("waitIssues: biên ±365, giờ 24:00, nguồn", () => {
    const src = dateSources(inputs, stages, 2);
    const ok = { source: "input:due", offset: "0", time: "09:00" };
    expect(waitIssues(ok, src)).toEqual({});
    expect(waitIssues({ ...ok, offset: "-365" }, src)).toEqual({});
    expect(waitIssues({ ...ok, offset: "365" }, src)).toEqual({});
    expect(waitIssues({ ...ok, offset: "366" }, src).offset).toBe("range");
    expect(waitIssues({ ...ok, offset: "-366" }, src).offset).toBe("range");
    expect(waitIssues({ ...ok, offset: "" }, src).offset).toBe("range");
    expect(waitIssues({ ...ok, offset: "1.5" }, src).offset).toBe("range");
    expect(waitIssues({ ...ok, time: "24:00" }, src).time).toBe("format");
    expect(waitIssues({ ...ok, time: "9:00" }, src).time).toBe("format");
    expect(waitIssues({ ...ok, time: "23:59" }, src)).toEqual({});
    expect(waitIssues({ ...ok, source: "" }, src).source).toBe("required");
    expect(waitIssues({ ...ok, source: "input:gone" }, src).source).toBe("invalid");
  });
});

describe("remind / escalate", () => {
  test("remindIssue: rỗng ok, 4…168", () => {
    for (const t of ["", " ", "4", "168", "24"]) expect(remindIssue(t)).toBeNull();
    for (const t of ["3", "169", "0", "-4", "4.5", "abc"]) expect(remindIssue(t)).toBe("range");
  });
  test("escalateIssues", () => {
    expect(escalateIssues({ on: false, afterH: "", groupId: "" }, "g1")).toEqual({});
    expect(escalateIssues({ on: true, afterH: "4", groupId: "g2" }, "g1")).toEqual({});
    expect(escalateIssues({ on: true, afterH: "2160", groupId: "g2" }, "g1")).toEqual({});
    expect(escalateIssues({ on: true, afterH: "2161", groupId: "g2" }, "g1")).toEqual({
      afterH: "range",
    });
    expect(escalateIssues({ on: true, afterH: "3", groupId: "" }, "g1")).toEqual({
      afterH: "range",
      groupId: "required",
    });
    expect(escalateIssues({ on: true, afterH: "48", groupId: "g1" }, "g1")).toEqual({
      groupId: "same",
    });
  });
});

describe("ttl-rules", () => {
  test("ttlIssue 1…365; 0/366 lỗi; không hết hạn bỏ qua ô", () => {
    expect(ttlIssue("1", false)).toBeNull();
    expect(ttlIssue("365", false)).toBeNull();
    expect(ttlIssue("0", false)).toBe("range");
    expect(ttlIssue("366", false)).toBe("range");
    expect(ttlIssue("", false)).toBe("range");
    expect(ttlIssue("", true)).toBeNull();
    expect(ttlIssue("999", true)).toBeNull();
  });
  test("ttlToValue / ttlFromValue round-trip", () => {
    expect(ttlToValue("7", false)).toBe(7);
    expect(ttlToValue("7", true)).toBeNull();
    expect(ttlToValue("0", false)).toBeNull();
    expect(ttlFromValue(null)).toEqual({ text: "", noExpiry: true });
    expect(ttlFromValue(30)).toEqual({ text: "30", noExpiry: false });
    expect(ttlToValue(ttlFromValue(30).text, ttlFromValue(30).noExpiry)).toBe(30);
  });
});

describe("tz-format", () => {
  const at = "2026-06-01T00:00:00Z";
  test("utcOffsetLabel", () => {
    expect(utcOffsetLabel("Asia/Ho_Chi_Minh", at)).toBe("UTC+07:00");
    expect(utcOffsetLabel("UTC", at)).toBe("UTC+00:00");
    expect(utcOffsetLabel("America/New_York", at)).toBe("UTC-04:00");
    expect(utcOffsetLabel("America/New_York", "2026-01-15T00:00:00Z")).toBe("UTC-05:00");
    expect(utcOffsetLabel("Asia/Kolkata", at)).toBe("UTC+05:30");
  });
  test("múi giờ lạ / thời điểm hỏng ⇒ rỗng", () => {
    expect(utcOffsetLabel("Not/AZone", at)).toBe("");
    expect(utcOffsetLabel("UTC", "x")).toBe("");
  });
  test("timeZoneOptions", () => {
    expect(timeZoneOptions(["Asia/Tokyo", "Not/AZone"], at)).toEqual([
      { id: "Asia/Tokyo", label: "Asia/Tokyo", hint: "UTC+09:00" },
      { id: "Not/AZone", label: "Not/AZone", hint: "" },
    ]);
  });
});

describe("error-keys", () => {
  test("map mã → khoá", () => {
    expect(ruleErrorKey("WAIT_INVALID")).toBe("process.admin.editor.stage.wait.err.WAIT_INVALID");
    expect(ruleErrorKey("ESCALATE_INVALID")).toBe(
      "process.admin.editor.stage.err.ESCALATE_INVALID",
    );
    expect(ruleErrorKey("OTHER")).toBeNull();
    expect(waitIssueKey("offset")).toBe("process.admin.editor.stage.wait.err.offset");
    expect(remindIssueKey()).toBe("process.admin.editor.stage.err.remind");
    expect(escalateIssueKey("afterH")).toBe("process.admin.editor.stage.err.escalateAfter");
    expect(escalateIssueKey("groupId")).toBe("process.admin.editor.stage.err.escalateGroup");
    expect(ttlIssueKey()).toBe("process.admin.editor.err.ttl");
  });
});
