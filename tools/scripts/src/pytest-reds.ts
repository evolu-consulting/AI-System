// Bước `py` của evotest (in-container.sh): đọc log `pytest -rfE`, in đỏ MỚI riêng với đỏ cũ (tests/known-red.json, suite `py`).
// Dùng: bun tools/scripts/src/pytest-reds.ts <log> <mã-thoát-pytest>. Thoát 0 nếu pytest xanh, hoặc (có TEST_QUARANTINE=1) chỉ còn đỏ cũ.
// Pytest đỏ mà log không rút được ca nào (sập, lỗi thu thập không kèm dòng ERROR) ⇒ tính 1 đỏ không rút được tên.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { reportReds } from "./known-red";
import { pytestReds, quarantineOn } from "./known-red.rules";

const [log, rcArg] = process.argv.slice(2);
if (!log) {
  console.error("dùng: bun pytest-reds.ts <log> <mã-thoát>");
  process.exit(2);
}
const rc = Number(rcArg ?? "0");
const reds = pytestReds(readFileSync(log, "utf8"));
// rc 5 = không thu thập được ca nào (bộ lọc sai) → đỏ thật, không phải "xanh".
const unattributed = rc !== 0 && reds.length === 0 ? 1 : 0;
process.exit(
  rc === 0
    ? 0
    : reportReds({
        root: resolve(import.meta.dir, "../../.."),
        label: "pytest",
        reds,
        unattributed,
        quarantine: quarantineOn(process.argv.slice(2), process.env),
      }),
);
