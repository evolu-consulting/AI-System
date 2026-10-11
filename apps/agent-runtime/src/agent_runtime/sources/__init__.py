"""P-b · PF-S2 · WRK-FR-27 · Nguồn tham chiếu (git/local/library) → mirror cache → snapshot chỉ-đọc.

Lớp thuần (fs + subprocess `git`, không `db`/`events`): cấu hình (`config`), lọc PB-R07
(`filter`), SSRF/driver git (`git_driver`), local_path (`local_driver`), dựng + cache snapshot
(`snapshot`, `cache`), resolve một item (`resolve`). Phần có DB/HTTP (claim job `source.resolve`,
báo `/sources-resolved`, tải tài liệu library) ở `runtimes/resolve`.
"""
