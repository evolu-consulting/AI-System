# Báo cáo đêm 2026-10-10 → 11: KH giai đoạn F, roadmap E → 5 (chỉ ở dev)

Tất cả mới dừng ở **dev** (Docker `kh-dev-f`, cổng 9102, HANA Express schema `KH_STAGEF`). **Chưa đụng tới prod**: không deploy BTP, không sửa Keycloak prod, không đụng HANA Cloud. Các nhánh đã push nhưng **chưa merge**.

## 1. Đã xong

| Hạng mục | Nhánh / commit | Kết quả trên dev |
|---|---|---|
| Giai đoạn F (capability platform `/v1`) | `kh-stage-f` (`c7265a4` … `a427c22`) | Giả lập consumer chạy 11/11 kịch bản, 202 check; smoke đạt |
| S1–S4: kh_people, worker, bench P1, replay | `kh-roadmap-e5` `06f3ae8` `bfba128` `6f849f0` `8252ab4` | Test đạt |
| S5–S9: worker chắt tri thức, summary ngày, kết quả bước, tín hiệu từ kh-helper, cổng duyệt + dừng toàn cục | `7c31a15` `41b5194` `f3f69e8` `dd84868` `4d36ec2` | Test đạt |
| S10–S13: job của worker, vòng học (thử 50/50), tầng daily trong `/context/step`, runner nhiều agent | `4646bea` `64ba358` `c8bebb2` `e910627`, sửa S7 `b6f6f4e` | Test đạt; bài test cài sẵn hiệu quả: +15 điểm % → giữ, −15 → rút, 0 → tiếp tục thử |
| S14: tự cải tiến (giai đoạn 5) | `1ff60c7`, nối tham số `a3d1d8f` | Chặn đầu độc 37/37; mặc định tắt |
| S15: tích hợp trên kh-dev-f | `8d2afde` (11 lỗi đã sửa) `e285453` | Chi tiết: `2026-10-11-roadmap-e5-dev.md` |

Kết quả chính của S15:
- Worker: dry ghi 0 bản ghi; trả 429 khi vượt ngân sách; chế độ `on` qua `claude_cli` dừng đúng ở trần $1/lượt; 10 item được duyệt, 5/5 được trả về theo key; chi phí ghi lại lệch < 0,001%.
- G5: 0 rò rỉ trên 52 chuỗi cài sẵn.
- Thử 50/50: chia nhánh 51,2% / 50,0%; bài học trung tính → giữ, gây hại → rút (p = 0,009), mẫu quá nhỏ → tiếp tục thử.
- Giai đoạn 4: trả 428 cho tới khi được duyệt; dừng toàn cục trả 423 trong 0,09–0,14 giây; resume khôi phục đúng.
- Giai đoạn 5: 37/37 qua HTTP; đề xuất `KH_STEP_FLOOR` 0,68 → 0,70 bị bench từ chối (đúng, vì tệ hơn).
- Tier 1: bật hay tắt cờ đều cho kết quả giống hệt.

Chi phí LLM thật phía KH: $1,17.

## 2. Các quyết định tôi tự đưa ra (cần fen xem)

1. Route của worker chạy dưới danh tính hệ thống của KH, sau khi qua luật auth dành cho worker và kiểm tra consent.
2. `/improve/propose` siết lại: chỉ maintainer, token worker (khi `KH_DISTILL_WORKER` là dry hoặc on), và agent của namespace trong `settings.improve.agent_namespaces`. Namespace mặc định đổi từ `kh_ops` sang `ops_pilot`, vì tên bắt đầu bằng "kh" bị chặn.
3. Daily: lỗi lấy dữ liệu của một project thì ghi lỗi rồi chạy tiếp project khác.
4. Cổng benchmark của vòng học dùng ngưỡng tổng "không kém quá 2%". Thiết kế §5.3 đòi chặt hơn (không câu nào giảm độ phủ, gói ngữ cảnh to thêm tối đa 5%); phần này **chưa làm**.
5. Backfill ($80) không tính vào trần tháng ($60) của worker.
6. Seed dữ liệu cho dev từ bản copy dev có sẵn (kh-dev-hana), **không đọc prod**. Replay "đổ log thật" vào 4 project mới: e5-distil, e5-distil2, e5-daily, e5-replay.

## 3. Việc còn mở

- G3 mới đạt 31% (bật hay tắt cờ đều vậy), phải chờ backfill. Entity card lấy từ dữ liệu prod có e-mail lọt vào 8 câu trả lời. **Cần fen quyết** che hay dọn.
- G4 (p95) chưa kết luận được: máy laptop dao động lớn hơn ngưỡng 5%. Nên đo lại trên BTP dev.
- Lock của cron vòng học có thể chờ tới 9 giờ sau deploy (giữ lock là chủ ý thiết kế).
- Replay trên log ticketing gán 49% bước là "failed". Cần audit 100 nhãn trước khi tin baseline.
- Chưa làm: quota tier 2 (4 lượt/tháng), cổng theo tỉ lệ rollback, xu hướng can thiệp theo quý.
- `test_project_match_weak` lỗi do so với registry thật (dự án `rita`, từ khóa "community"); lỗi này có từ trước.
- `test_context_step` thỉnh thoảng lỗi do ChromaDB "Nothing found on disk"; cũng có từ trước.
- Dữ liệu giả lập còn trong `KH_STAGEF`: các project e5-* và kh-leaktest, namespace `ops_pilot`.
- Khóa ký cũ của kh-dev-f từng lộ một phần trong output của agent: **đã đổi khóa**, không container nào còn dùng khóa đó.

## 4. Checklist duyệt để lên prod (chỉ làm sau khi fen duyệt)

1. [ ] Đọc báo cáo này và changelog S15.
2. [ ] Rebase `kh-roadmap-e5` lên `origin/main` (main đang có 1 commit mới hơn), chạy lại toàn bộ test, rồi merge. Nhánh này đã bao gồm `kh-stage-f`.
3. [ ] Chọn cách cấp client cho namespace:
   - `KH_NS_PROVISIONER=local` (mặc định): KH tự cấp secret và chỉ lưu hash.
   - `keycloak`: cần một bản release của extension Keycloak có route `/kh/namespaces`.

   Trên prod **không bật** `KH_DEV_BOOTSTRAP`; code cũng tự chặn trên CF, HANA Cloud và schema `KNOWLEDGE_HUB`.
4. [ ] Tạo khóa ký principal mới cho prod (`KH_PRINCIPAL_SIGNING_KEY`), đặt bằng `cf set-env`, không đưa vào git.
5. [ ] HANA Cloud: đường vector trên HANA (REAL_VECTOR) **chưa được test**, vì HANA Express không có. Chạy bộ test HANA trên một schema test của HANA Cloud trước.
6. [ ] Kiểm `HANA_POOL_SIZE` (mặc định 5): thêm bảng caps và cron vòng học thì cần thêm kết nối.
7. [ ] Deploy app KH: mọi cờ mới **mặc định tắt**.
8. [ ] Deploy `kh-worker` (CF app, `deploy/btp/kh-worker/manifest.yml`) ở chế độ `dry`, trần $3/lượt, $60/tháng.
9. [ ] Bật từng cờ theo cổng (thiết kế §6–7): `KH_CAP_PEOPLE` → `OUTCOMES` → `DAILY` → `KH_LEARN_MODE=record` → `trial` → `KH_IMPROVE_MODE=shadow`. Mỗi bước chạy tier 2 và yêu cầu không kém quá 2%.
10. [ ] Quyết vụ e-mail trong entity card (mục 3).

## 5. Dây chuyền tự động (sản phẩm riêng)

Báo cáo nằm ở repo của dây chuyền (nhánh `sdlc-line`, file `Slaves/SDLC/line/STATUS-2026-10-11.md`).

- Đủ 20 khối của thiết kế, chạy trên dev; 523 test đạt; end-to-end giả lập 6/6; chaos 9/9.
- Nối với RAG System trên kh-dev-f, namespace `line_dev`: event và record đầy đủ, không thiếu.
- Chạy thật với model: xanh 2 lần, lần cuối bật hết tính năng. Tổng chi phí chạy thật ≈ $8,98.
