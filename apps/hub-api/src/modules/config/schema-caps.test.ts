// CR-118 · cr118-schema-caps-prod · quyết định lúc boot theo APP_ENV (thuần).
import { describe, expect, test } from "bun:test";
import { type HubSchemaCaps, missingCaps, schemaCapsVerdict } from "./schema-caps";

const ALL: HubSchemaCaps = {
  packAgents: true,
  userDefaultApp: true,
  tenantDefaultApp: true,
  profileVersion: true,
};

describe("CR-118 · schemaCapsVerdict", () => {
  test("production thiếu ⇒ fatal; test/development thiếu ⇒ warn; đủ ⇒ ok", () => {
    const miss = { ...ALL, packAgents: false, profileVersion: false };
    expect({
      prodMiss: schemaCapsVerdict("production", miss),
      testMiss: schemaCapsVerdict("test", miss),
      devMiss: schemaCapsVerdict("development", miss),
      prodOk: schemaCapsVerdict("production", ALL),
      missing: missingCaps(miss),
    }).toEqual({
      prodMiss: "fatal",
      testMiss: "warn",
      devMiss: "warn",
      prodOk: "ok",
      missing: ["packAgents", "profileVersion"],
    });
  });
});
