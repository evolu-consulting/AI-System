import { expect, test } from "bun:test";
import { deleteAction } from "./delete-action";

test("deleteAction: ẩn với non-owner, khoá khi nhiều phiên bản, còn lại bật", () => {
  expect(deleteAction({ versions_count: 1 }, false)).toBe("hidden");
  expect(deleteAction({ versions_count: 3 }, undefined)).toBe("hidden");
  expect(deleteAction({ versions_count: 2 }, true)).toBe("versions");
  expect(deleteAction({ versions_count: 1 }, true)).toBe("enabled");
  expect(deleteAction({}, true)).toBe("enabled");
});
