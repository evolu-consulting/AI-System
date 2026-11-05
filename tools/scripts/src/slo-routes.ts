// CR-117 · đọc access log nginx (stdin) → in JSON `{ "contracts.list": { n, p95_ms }, … }` cho ops-slo-status.sh (chạy qua service `tool`).
import { routeStats } from "./slo-routes.rules";

const text = await new Response(Bun.stdin.stream()).text();
console.log(JSON.stringify(routeStats(text.split("\n"))));
