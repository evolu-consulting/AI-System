> **INTERNAL - do not ship to customers.** Internal design documents of the DLC engine (they name source
> paths and internal decisions). Customers receive `docs/dlc/` only.

# AI SDLC — design (cập nhật 2026-10-11)

Bộ design của dây chuyền implementation + testing tự động: từ Spec Pack đã chốt tới QAS xanh. Mở các file HTML bằng trình duyệt (không cần server).

| File | Nội dung |
|---|---|
| `AI-SDLC-Autonomous-Build-Report.html` | **Design chính.** Mục 0-10: dây chuyền, vai trò, thứ tự, hai tầng, tự học, plug-in/out agent, 4 flow (New system, Enhancement, Bug fix, Feature migration v1 → v2). Mục 11: ước lượng (giờ, chuyển 8h / 24h mỗi ngày). Mục 12: 46 vấn đề thực tế dùng để đánh giá. Mục 13: gói tăng cứng. Mục 14: các mục cần thêm ở phía RAG System. Mục 15: giai đoạn tích lũy trước vận hành. Mục 16: target stack (Python, CAP, UI5 TS, React). Mục 17: seal không chặn + scan theo phần thay đổi, kèm số đo mô phỏng. Rê chuột lên node để xem nhanh, bấm node để mở chi tiết. |
| `AI-SDLC-Guards-Report.html` | 12 guard học từ các bên lớn (Spotify, Meta, GitHub, Cognition, Anthropic, Airbnb, Google, AWS, Uber, Replit) và cách gắn vào 3 flow. |
| `AI-SDLC-Status-Report.html` | Trạng thái thực tế từng bước của 4 flow (xong / còn cấn / chưa đụng), rê chuột lên node để xem cần gì, đã có gì, còn cấn gì, bằng chứng. |
| `AI-SDLC-Issues-Debate-Report.html` | 46 vấn đề thường gặp của SDLC (kiểu cũ và có agent AI), phản biện với design, dây chuyền sau khi vá, top 10 bản vá, đánh giá lại lần 2. |

## Các quyết định đã chốt

- Mục 3 (hiểu spec, yêu cầu trái ngược, thay hay giữ logic cũ): **con người quyết định**.
- Mục 6 (agent làm lệch / sai) và mục 8 (tự học): **model mạnh nhất phán xét**, run sau chấm đúng / sai; không nới lỏng guard an toàn.
- Deploy lên QAS **chỉ theo khung giờ cố định**, trừ khi người ra lệnh hoặc task urgent do người gắn.
- Tài liệu này chỉ nói về loại hệ thống đi kèm (RAG System có cấu trúc), không gắn với sản phẩm cụ thể.

## Sinh lại report

Dữ liệu và renderer nằm trong `source/` (Python 3.10+, chỉ dùng thư viện chuẩn). Sửa dữ liệu rồi chạy:

```
cd source
python make_autonomous_report.py
python make_guards_report.py
python make_issues_report.py
python make_status_report.py
```

Mỗi lệnh ghi file HTML tương ứng ra thư mục cha (`docs/design/`).

| File nguồn | Chứa gì |
|---|---|
| `make_autonomous_report.py` | Trang design chính, sơ đồ mục 0, các bảng mục 1-15 |
| `node_internals.py`, `nodes_vi_a.py`, `nodes_vi_b.py`, `nodes_vi_c.py` | Nội dung từng node (tooltip + modal chi tiết) |
| `friendly_titles.py` | Tiêu đề node kiểu dễ hiểu |
| `hardening_a.py`, `hardening_b.py` | Gói tăng cứng gắn vào node + bảng mục 13 |
| `design_status.py` | Trạng thái của 46 vấn đề trong design (mục 12) |
| `issue_debate_data.py` | 46 vấn đề, bằng chứng, phản biện, cách cover |
| `sdlc_guard_data.py`, `make_guards_report.py` | Report Guards |
| `make_issues_report.py` | Report Issues |
| `nodes_vi_d.py` | Node của Flow 4 (Feature migration) trong trang design chính |
| `make_status_report.py` | Report trạng thái 4 flow (dữ liệu node + renderer) |
| `swimlane.py` | Renderer SVG (swimlane, DAG, sơ đồ khối) |

Trạng thái ở mục 12 sau khi tăng cứng là tự đánh giá, chưa được chấm độc lập lần 3.

## Trạng thái build (2026-10-11)

Bản build theo thiết kế này nằm ở nhánh `sdlc-line`, package `Slaves/SDLC/line/`. Trạng thái, kết quả test và việc còn mở: `line/STATUS-2026-10-11.md`.
