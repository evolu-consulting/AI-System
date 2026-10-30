// `bun run e2e:lanes [--prune]` — liệt kê/dọn làn e2e; `bun run e2e:reap` — tắt bun/node của CHÍNH checkout này
// đang nghe cổng trong dải làn của nó (không đụng đường dẫn khác hay dịch vụ hệ thống).
import { listLanes, pruneLanes, resolveLane, sweepLane } from "./e2e-lane";
import { repoRoot } from "./lib/git";

const cmd = process.argv[2];
const root = repoRoot();

if (cmd === "lanes") {
  if (process.argv.includes("--prune")) {
    const { dropped } = pruneLanes();
    console.log(`e2e:lanes: bỏ ${dropped.length} làn (${dropped.join(", ") || "-"})`);
  }
  const lane = resolveLane(root);
  for (const [p, l] of Object.entries(listLanes()).sort((a, b) => a[1] - b[1]))
    console.log(
      `  làn ${l}: ${p}${p === root.replaceAll("\\", "/").toLowerCase() ? "  <= đây" : ""}`,
    );
  console.log(`e2e:lanes: checkout này = làn ${lane}`);
} else if (cmd === "reap") {
  const lane = resolveLane(root);
  const pids = sweepLane(root, lane);
  console.log(`e2e:reap: làn ${lane}, đã tắt ${pids.length} tiến trình ${pids.join(",")}`);
} else {
  console.error("dùng: e2e-lane.cli.ts lanes [--prune] | reap");
  process.exit(2);
}
