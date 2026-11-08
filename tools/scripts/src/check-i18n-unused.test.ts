import { describe, expect, test } from "bun:test";
import { collectLiterals, findUnused } from "./check-i18n-unused";

describe("check-i18n-unused (CR-125 c3)", () => {
  const lits = new Set<string>();
  collectLiterals(
    [
      't("tenants.tab.apps")',
      "t(`tenants.status.${s}`)",
      'useT("contracts.settings")',
      "const x = 'chat.title'",
    ].join("\n"),
    lits,
  );
  test("khoá dùng trực tiếp / theo tiền tố động / theo namespace ⇒ không báo", () => {
    expect(
      findUnused(
        ["tenants.tab.apps", "tenants.status.on", "contracts.settings.sec.flow", "chat.title"],
        lits,
      ),
    ).toEqual([]);
  });
  test("khoá không ai gọi ⇒ báo", () => {
    expect(findUnused(["tenants.slots.routing.noneAssigned", "tenants.tab.apps"], lits)).toEqual([
      "tenants.slots.routing.noneAssigned",
    ]);
  });
});
