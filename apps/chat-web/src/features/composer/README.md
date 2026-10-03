# composer — ô nhập (UC-02, UC-04 · CHAT-AC-05, 10, 18)
`components/Composer` dùng cho ô chính (`variant="main"`, "Hỏi điều mới…" → flow mới) và khung flow (`variant="flow"`). Enter gửi · Shift+Enter xuống dòng · Esc dừng; run của chính ô đang chạy → nút Dừng (Enter không gửi); run khác trong hội thoại → gõ được, Gửi `disabled` + tooltip busy.
Nháp `hooks/use-draft` (`localStorage` qua `~/lib/storage`, khoá `lib/composer-logic#draftKey`). `QuotaNotice`: nhắc khi `run.started.quota.state = over`, "Ẩn nhắc" nhớ trong phiên (`sessionStorage`, try/catch).
