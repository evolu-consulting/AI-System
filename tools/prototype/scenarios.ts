// `bun run proto:scenarios <thư-mục-CR>` — in khung Delta (mỗi bước trong luồng = một Kịch bản) để dán vào tasks.md
import { loadPrototype } from "./cli";
import { scenarioSkeleton } from "./scenarios.rules";

console.log(
  scenarioSkeleton(loadPrototype(process.argv[2], "bun run proto:scenarios docs/specs/<CR>")),
);
