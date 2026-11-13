// CR-142 · bộ chuyển dữ liệu admin ⇒ sơ đồ cây xem trước.
import { expect, test } from "bun:test";
import type { OrgResponse } from "@ai/contracts/org";
import { toChartDepts } from "./org-chart-data";

const U1 = "00000000-0000-4000-8000-000000000001";
const U2 = "00000000-0000-4000-8000-000000000002";
const G = "00000000-0000-4000-8000-0000000000a1";

test("trưởng phòng + thành viên theo tên; người không có trong danh sách bị bỏ qua", () => {
  const org = {
    members: [{ user_id: U1, display_name: "An" }],
    departments: [
      {
        group_id: G,
        key: "kd",
        name: "Kinh doanh",
        head_user_id: U1,
        parent_group_id: null,
        member_ids: [U1, U2],
      },
    ],
  } as unknown as OrgResponse;
  const [d] = toChartDepts(org);
  expect(d).toMatchObject({
    id: G,
    name: "Kinh doanh",
    parentId: null,
    head: { id: U1, name: "An" },
  });
  expect(d?.members).toEqual([{ id: U1, name: "An" }]);
  expect(toChartDepts(undefined)).toEqual([]);
});
