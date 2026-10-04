// HUB-NFR-04 · H1-R26 · log có run_id/tenant_id/user_id; không in JWT, secret, nội dung tin.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { logger, setMinLevel, setSink } from "./logger";

const JWT = "eyJhbGciOiJFZERTQSJ9.eyJzdWIiOiJ1In0.c2lnbmF0dXJl";
let lines: string[] = [];
let restore: () => void = () => {};

beforeEach(() => {
  lines = [];
  restore = setSink((_l, line) => lines.push(line));
  setMinLevel("debug");
});
afterEach(() => {
  restore();
  setMinLevel("warn");
});

describe("hub-api logger", () => {
  test("H1-R26 · child mang request_id, run_id, tenant_id, user_id", () => {
    logger
      .child({ request_id: "r1", tenant_id: "t1" })
      .child({ run_id: "run1", user_id: "u1" })
      .info("run.started", { seq: 1 });
    const rec = JSON.parse(lines[0] ?? "{}");
    expect(rec).toMatchObject({
      level: "info",
      msg: "run.started",
      request_id: "r1",
      run_id: "run1",
      tenant_id: "t1",
      user_id: "u1",
      seq: 1,
    });
  });

  test("H1-R26 · che key nhạy cảm và giá trị dạng JWT/Bearer ở mọi trường", () => {
    logger.warn(`auth failed Bearer ${JWT}`, {
      authorization: `Bearer ${JWT}`,
      api_key: "k",
      content: "chuỗi mồi nội dung tin",
      prompt: "p",
      note: `token=${JWT}`,
    });
    const line = lines[0] ?? "";
    expect(line).not.toContain(JWT);
    expect(line).not.toContain("chuỗi mồi");
    const rec = JSON.parse(line);
    expect(rec.api_key).toBe("[redacted]");
    expect(rec.content).toBe("[redacted]");
    expect(rec.prompt).toBe("[redacted]");
  });

  test("HUB-NFR-04 · bỏ dòng dưới mức tối thiểu", () => {
    setMinLevel("error");
    logger.info("skip");
    logger.fatal("keep");
    expect(lines.length).toBe(1);
    expect(JSON.parse(lines[0] ?? "{}").level).toBe("fatal");
  });
});
