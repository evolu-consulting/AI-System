// CR-122 · B · nạp 3 flow mẫu (Duyệt 2 cấp / theo giá trị / theo phòng ban) vào Thư viện, đã xuất bản. CHẠY LẠI ĐƯỢC (không nhân bản).
//   docker compose -p sohoptac2 run --rm -T tool tools/scripts/src/seed-flow-templates.ts [--apply]
// Mặc định chạy thử (chỉ kiểm hợp lệ, không ghi); `--apply` mới ghi. Env: HUB_DATABASE_URL (‖ DATABASE_URL).
import { connectDb } from "../../../apps/hub-api/src/lib/db";
import { FLOW_TEMPLATES } from "../../../apps/hub-api/src/modules/processes/library/flow-templates.def";
import {
  assertFlowTemplatesValid,
  seedFlowTemplates,
} from "../../../apps/hub-api/src/modules/processes/library/flow-templates.seed";

const apply = process.argv.includes("--apply");
assertFlowTemplatesValid();
if (!apply) {
  console.log(
    `seed-flow-templates: ${FLOW_TEMPLATES.length} mẫu hợp lệ (chạy thử — thêm --apply để ghi)`,
  );
} else {
  const url = process.env.HUB_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("seed-flow-templates: thiếu HUB_DATABASE_URL / DATABASE_URL");
  const hub = connectDb(url, 2);
  try {
    const r = await seedFlowTemplates(hub);
    console.log(
      `seed-flow-templates: tạo ${r.created.length} (${r.created.join(", ")}), đã có ${r.existing.length}`,
    );
  } finally {
    await hub.close();
  }
}
