import { expect, test } from "bun:test";
import { deleteAction } from "./delete-action";

test("deleteAction: ẩn khi không can_delete, khoá khi nhiều phiên bản, còn lại bật", () => {
  expect(deleteAction({ can_delete: false, versions_count: 1 })).toBe("hidden");
  expect(deleteAction({ versions_count: 3 })).toBe("hidden");
  expect(deleteAction({ can_delete: true, versions_count: 2 })).toBe("versions");
  expect(deleteAction({ can_delete: true, versions_count: 1 })).toBe("enabled");
  expect(deleteAction({ can_delete: true })).toBe("enabled");
});
