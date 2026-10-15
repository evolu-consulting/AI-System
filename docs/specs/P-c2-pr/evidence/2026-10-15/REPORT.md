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
