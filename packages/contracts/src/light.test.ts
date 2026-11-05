import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { MY_APPS_PATH } from "./app-catalog";
import { RETRY_AFTER_HEADER, TOO_MANY_RUNS_RETRY_AFTER_S } from "./chat/errors";
import * as light from "./light";
import { CONTRACT_DATE_FIELDS, CONTRACT_DUE_PRESETS } from "./pack-contracts/list";

describe("CR-118 bundle · @ai/contracts/light (hằng số không zod)", () => {
  test("module cũ vẫn xuất đúng cùng giá trị", () => {
    expect(MY_APPS_PATH).toBe(light.MY_APPS_PATH);
    expect(RETRY_AFTER_HEADER).toBe(light.RETRY_AFTER_HEADER);
    expect(TOO_MANY_RUNS_RETRY_AFTER_S).toBe(light.TOO_MANY_RUNS_RETRY_AFTER_S);
    expect(CONTRACT_DATE_FIELDS).toBe(light.CONTRACT_DATE_FIELDS);
    expect(CONTRACT_DUE_PRESETS).toBe(light.CONTRACT_DUE_PRESETS);
  });

  test("light.ts không import gì (đặc biệt không zod)", () => {
    expect(readFileSync(new URL("./light.ts", import.meta.url), "utf8")).not.toMatch(
      /^\s*import\s/m,
    );
  });
});
