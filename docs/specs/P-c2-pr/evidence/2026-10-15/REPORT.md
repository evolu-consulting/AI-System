# UAT P-c2 — REPORT (2026-10-15)

**Người chạy:** qc-uat (D3) · **Mốc:** P-c2 (HUB-FR-129) · **Kết luận: KHÔNG ĐẠT** — 2 Blocker tầng tích hợp (lọt qua test khoá).

> REPORT này do điều phối ghi lại từ báo cáo của qc-uat (công cụ ghi file của agent từ chối tạo `.md` trong phiên). Evidence (ảnh, `result.json`, `result-s6.json`, `runs.json`, `scripts/`, `logs/`) do qc-uat commit path-scoped.

## Môi trường
- Chromium `locale: vi-VN`. Hub thật in-process, Runtime thật trong Docker (sandbox), apply giả bằng directive `#fake:apply=…`, GitHub = mock (cổng 4040).
- Tenant `evolu` (user `julian.bui`) + tenant `uatb` (user `uat.badmin`) để kiểm cách ly.
- Hai **shim UAT** (KHÔNG sửa file sản phẩm) để vượt qua B1/B2 mà xác minh phần còn lại:
  - `scripts/shim/sitecustomize.py` — bỏ `detail` khi null, mount vào container Runtime (vòng qua B1).
  - `scripts/uat-server.ts` — bản sinh từ `server.ts` kèm vòng `setInterval(sweepOnce, 3s)` (vòng qua B2).
- Windows: pytest/sandbox thật của Runtime KHÔNG chạy được.

## Kết quả tổng
- **e2e khoá:** P-c2 **17/17** xanh; P-c hồi quy **14/14** xanh.
- **UAT thật (có shim):** 24/26 kịch bản Đạt. Không shim → luồng Áp không chạy hết trên Hub/Runtime thật (do B1+B2).

### Đạt (24 kịch bản)
| Kịch bản | Kết quả |
|---|---|
| `pr` (mặc định) | PR link chỉ khi https, mở tab mới, `rel=noopener noreferrer` |
| `auto_merge` | Hiện "Tự gộp: bật" |
| `branch_only` | Không mở PR, không link |
| `local_path` | Bị ép `branch_only` |
| rebase | UI "Đã rebase lên …" |
| diff rỗng | "Không có thay đổi", không có job Áp |
| `conflict` | Đúng |
| mã lỗi `check_failed`,`auth`(+đổi token UI),`no_credential`,`push_rejected`,`network`,`provider_error`,`rate_limited` | Đúng |
| "Thêm 1 lần làm lại" | Tạo job Áp mới |
| "Huỷ lượt chạy" | → `cancelled` |
| Cách ly tenant | Tenant khác 404 khi đọc/sửa/xoá run/khoá của `evolu`; 422 khi tạo nguồn dùng khoá `evolu` |
| UI khoá nguồn | Không lộ token (DOM/API/DB/config); khoá đang dùng → "Xoá khoá" bị tắt |
| F3 admin run view (chưa có e2e) | Kiểm tay kết quả Áp + quyết định — đúng |
| Mobile 390px | Không vỡ |

### Chưa chạy được
- `unsupported_provider`: form chặn host gitlab từ đầu; chỉ e2e/int phủ.
- **Git/push thật lên github.com: S1 = hard stop**, chờ người dùng cấp repo + PAT.

## Lỗi

### Blocker (backend-lead sửa)
**B1** — `apps/agent-runtime/src/agent_runtime/apply/report.py:96` gửi `"detail": null`, nhưng `packages/contracts/src/hub-internal/apply.ts:32` là `z.string().max(…).optional()` (không nhận `null`). Hub trả **400** cho hầu hết báo cáo apply → job `source.apply` thành `failed`, run kẹt `running`. Ảnh: `BUG1-A-run-ket-o-running.png`. Tái hiện: `!fixbug-pr` với `test_cmd` = `bun test #fake:apply=pushed`, qua cổng duyệt "Đạt".

**B2** — Hub production không có vòng nền gọi `sweepOnce` của process: `apps/hub-api/src/server.ts:177` không truyền `onProcessHandles`; `apps/hub-api/src/modules/processes/processes.mount.ts:90-92` chỉ start `poster` + `khWriter`. Stage Áp không bao giờ mở PR; run kẹt ≥ 3,5 phút với `autofix_applies` ở `pushed`. Các việc khác của `sweepOnce` (interrupted, `resolveTimeouts`, `requeueOrphans`) cũng không chạy trong Hub thật. Có shim `setInterval(sweepOnce, 3s)` → PR mở ngay. Log: `logs/bug2-sweep-khong-chay.txt`.

### Minor
- **pr_url host lạ** — `ApplyPrLink.tsx` chỉ kiểm `https://`; host chỉ bị ép lúc Hub ghi. Sửa SQL thành `https://evil.example/...` thì UI vẫn hiện link. Đề xuất: kiểm host ở lớp view (backend) và/hoặc UI (frontend). (X1-FAIL-*.png)
- **Nhãn "Test đỏ · exit - · 0,0 giây"** — khi `check_failed`, `AutofixFailures.tsx:63` đọc `view.test?.exit_code` nhưng `ApplyStageView` không có trường `test` (DB có `test_exit_code=1`). Kết quả test re-run sau rebase cũng không hiện. Đề xuất: backend thêm trường `test` vào view (FE đã đọc sẵn).
- **Đua `source.resolve`** — 2/16 lần chạy đầu bị `source_unresolvable` ngay sau `resolve.done ok=true` (`runs/sweeps.ts`, `resolveTimeouts`). Không tái hiện lần chạy lại; có thể lộ rõ khi sửa B2.
- **"Huỷ lượt chạy" trên run đã Hoàn tất** — `run-access.rules.ts:41` `canCancel` không xét trạng thái. Có từ P-a, không thuộc P-c2 (tech-debt).
- **`hub:dev` thiếu cấu hình** — không truyền `PUBLIC_HUB_URL` cho admin-web dev (thiếu → mục Quy trình/Nguồn ẩn, `/sources` "Không tìm thấy"), không truyền `GIT_CONFIG_*` cho Runtime.

## Dọn dẹp
- Đã dừng admin-web, chat-web, hub-api, admin-api, mock GitHub, proxy, hub-dev, container Runtime. Postgres + Redis vẫn chạy.
- Dữ liệu UAT còn trong DB dev: quy trình `fixbug-pr` (bản chép), nguồn `repo`/`repo-local`, khoá `uat-pat`, tenant `uatb`/`uat.badmin`, các run. Locale `julian.bui` đã trả về `en`.
- Hai shim chỉ để UAT; **bỏ cả hai sau khi sửa B1 + B2**.

## Chạy lại
`scripts/uat.mjs` cần Hub/Runtime/mock/proxy dựng bằng `start-hub.sh`, `runtime-git.mjs`, `origin.sh`, `ghproxy.mjs`. Sau khi sửa B1+B2 → bỏ shim, chạy không shim để xác nhận luồng Áp chạy hết trên Hub/Runtime thật.

## Vòng 2 (re-UAT) — 2026-10-15

**Người chạy:** qc-uat · **Kết luận: ĐẠT** (B1, B2, M-test-field đã hết, không cần shim; không hồi quy). Một lỗi Minor đã biết (M-pr-host, TECH-DEBT #179) chấp nhận.

### Môi trường vòng 2
- Hub **thật**: `bun run hub:dev` (chạy `apps/hub-api/src/server.ts` nguyên bản, `processLoops` mặc định bật ⇒ `startProcessSweeper` thật), thêm env `HUB_PROCESS_ENGINE=on`, `HUB_GITHUB_API_URL=http://127.0.0.1:4041` (proxy lỗi → mock :4040), `HUB_GITHUB_WEB_HOST=github.com`. admin-web :3000 (`PUBLIC_HUB_URL`), chat-web :3100.
- Runtime thật trong Docker (`scripts/runtime-git.mjs` **không** đặt `UAT_SHIM`, **không** mount `sitecustomize.py`), bare repo qua `origin.sh`, apply `#fake:apply=…`. KHÔNG dùng `uat-server.ts`, KHÔNG `setInterval(sweepOnce)`, KHÔNG gọi sweep tay (script chỉ `sleep` chờ).
- Đổi script UAT (file evidence): `scripts/flow.mjs` (ảnh ra thư mục tạm rồi đổi hậu tố `-r2`; thêm đo Đạt→PR). Truy vấn bằng chứng: `scripts/r2/q*.mjs`.
- Lưu ý chạy: admin-web hiện tiếng Anh nếu locale user = `en` (lỗi script, không phải lỗi app) ⇒ đặt `vi` bằng `scripts/locale.mjs` trước khi chạy, trả về `en` sau khi xong. Hub cần `HUB_PROCESS_ENGINE=on` (không có ⇒ `/process-defs` 404).
- Log: `logs/uat-run-r2.log`, `logs/e2e-pc2-r2.log`; kết quả JSON: `result-r2.json`, `result-s6-r2.json`, `runs-r2.json`.

### Kết quả theo kịch bản
| # | Kịch bản | Kết quả | Bằng chứng |
|---|---|---|---|
| 1 | **B2 fixed** — `pr`: Đạt → stage Áp **tự** mở PR, không sweep tay | **Đạt** — Đạt 01:05:08.250 → PR mở 01:05:10.667 = **2,4 s** (`auto_merge`: 1,6 s). UI hiện PR #n + "Đã mở PR" | `s1-pr-A-region-r2.png`, `s1-pr-A-run-ket-qua-r2.png`, `s1-pr-D-admin-run-r2.png`, `s1-pr-B-gate-r2.png`, `s1-pr-A-thread-r2.png` |
| 2 | **B1 fixed** — báo cáo apply có `detail: null` | **Đạt** — `report.py:96` vẫn gửi `detail` = null (không đổi); Hub trả **201** cho cả 22 `apply-result` (0 × 400); 22/22 job `source.apply` = `succeeded`, 0 `failed`; mọi run sang `done`/`needs_decision`, không kẹt `running` (đối chiếu `BUG1-A-run-ket-o-running.png` vòng 1) | `logs/uat-run-r2.log`, `scripts/r2/q.mjs`; `s1-pr-A-run-ket-qua-r2.png` |
| 3 | **M-test-field** — `check_failed` | **Đạt** — UI hiện "Test đỏ · exit 1 · 0.0 giây" (không còn "exit -"); thời gian 0 vì test giả 1 ms | `e2-checkfailed-D-admin-run-r2.png`, `e2-checkfailed-A-run-quyet-dinh-r2.png` |
| 4 | Hồi quy: `auto_merge` ("Tự gộp: bật") | Đạt | `s2-auto-*-r2.png` |
| | `branch_only` (không PR, không link) | Đạt | `s3-branch-*-r2.png` |
| | `local_path` ép `branch_only` | Đạt | `s4-local-*-r2.png` |
| | rebase ("Đã rebase lên …") | Đạt | `s5-rebase-*-r2.png` |
| | diff rỗng ("Không có thay đổi", 0 job Áp) | Đạt (chạy bằng `s6.mjs`; bước S6 trong `uat.mjs` FAIL do script tái dùng run trước — như vòng 1) | `s6-*-r2.png`, `result-s6-r2.json` |
| | `conflict` | Đạt | `e1-conflict-*-r2.png` |
| | mã lỗi `check_failed`, `auth`, `no_credential`, `push_rejected`, `network`, `provider_error`, `rate_limited` | Đạt (cả 7) | `e2…e8-*-r2.png` |
| | `auth` qua UI (đổi token) | Đạt | `e9-*-r2.png` |
| | "Thêm 1 lần làm lại" (job Áp 1→2) → "Huỷ lượt chạy" → `cancelled` | Đạt | `e6-network-A-*-r2.png` |
| 5 | Cách ly tenant (`uatb` không thấy run/khoá `evolu`; API + UI) | Đạt | `T1`, `00-O-admin-tenant-khac-r2.png` |
| 6 | F3 admin run view: kết quả Áp + quyết định | Đạt (khối "Kết quả áp bản sửa", PR link, quyết định) | `s1-pr-D-region-r2.png`, `e*-D-admin-run-r2.png` |
| 7 | e2e khoá `playwright.pc2.config.ts` (DB `pc2_e2e`) | **17/17 xanh** | `logs/e2e-pc2-r2.log` |
| + | UI khoá nguồn (K1) không lộ token; K2 gitlab tắt "Mở PR" | Đạt | `k1-*-r2.png`, `k2-*-r2.png` |
| + | X1 pr_url host lạ (tamper SQL) vẫn hiện link | **Không đạt (Minor, đã biết)** = M-pr-host, TECH-DEBT #179 — chấp nhận | `X1-FAIL-*-r2.png` |

Tổng `uat.mjs`: 22 PASS, 2 FAIL (S6 = lỗi script đã chạy lại bằng `s6.mjs` → Đạt; X1 = M-pr-host đã chấp nhận).

### Lỗi còn lại
- Blocker: không. Major: không.
- Minor (không chặn): M-pr-host (#179, backend/frontend, defense-in-depth). Đua `source.resolve` ở vòng 1: vòng này **không tái hiện** (0/22 run `source_unresolvable`). "Huỷ lượt chạy" trên run đã Hoàn tất (từ P-a), `hub:dev` thiếu `PUBLIC_HUB_URL`/`GIT_CONFIG_*`/`HUB_PROCESS_ENGINE`: giữ nguyên, ngoài phạm vi.
- Nhỏ: thời lượng test hiện "0.0 giây" (dấu chấm) trên admin-web nhưng "0,0 giây" (dấu phẩy) trên chat-web ở khối quyết định — format số không nhất quán (frontend-lead, Minor).

### Giới hạn / chưa xác minh
- Runtime pytest/sandbox thật không chạy trên Windows; apply dùng `#fake:apply` + bare repo. B1 xác minh qua báo cáo thật của Runtime tới Hub thật.
- **S1 (hard stop): git/push + PR thật lên github.com** vẫn chờ người dùng cấp repo + PAT; chưa làm.
- `unsupported_provider` chỉ phủ bằng e2e/int (form chặn host gitlab).

### Dọn dẹp
Đã dừng hub-dev (admin-api, hub-api), admin-web, chat-web, mocks, ghproxy, container Runtime. Postgres + Redis vẫn chạy. Locale `julian.bui`/`uat.badmin` trả về `en`.
