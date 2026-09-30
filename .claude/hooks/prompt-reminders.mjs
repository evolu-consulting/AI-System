// UserPromptSubmit: nhắc Claude HỎI người dùng (không tự chạy) khi prompt có vẻ cần Readiness hoặc Intake.
let raw = '';
process.stdin.on('data', (c) => (raw += c));
process.stdin.on('end', () => {
  let prompt = '';
  try { prompt = String(JSON.parse(raw).prompt ?? ''); } catch { prompt = raw; }
  // Bỏ qua thông báo hệ thống / kết quả agent nền — không phải tin nhắn người dùng.
  if (/<task-notification>|\[SYSTEM NOTIFICATION/.test(prompt)) return;
  const p = prompt.toLowerCase();
  const notes = [];

  const wantsCode = /\b(implement|build)\b|\bcode (đi|luôn|tiếp|feature|task)|bắt đầu code|(làm|chạy|tiếp tục) (task|feature|m[0-9]|spec)|làm tiếp task/.test(p);
  if (wantsCode) {
    notes.push('[readiness-hook] Prompt có vẻ yêu cầu viết code. Nếu đúng và spec liên quan chưa READY (hoặc đã đổi sau lần READY): HỎI người dùng xác nhận có chạy spec-readiness không (CLAUDE.md Luật 1). Không phải yêu cầu code thì bỏ qua.');
  }

  const intakeWords = /(yêu cầu (mới|thêm|thay đổi)|thay đổi (yêu cầu|luật|spec|nghiệp vụ)|thêm tính năng|khách( hàng)? (muốn|yêu cầu)|feedback|bổ sung (yêu cầu|tính năng|luật)|requirement|change request|đổi lại (luật|cách))/.test(p);
  const hasDocs = /\.(md|docx?|pdf|xlsx?|csv|txt)\b/.test(p);
  const isLong = prompt.length >= 800;
  if (intakeWords || hasDocs || isLong) {
    notes.push('[intake-hook] Prompt có thể chứa thông tin/yêu cầu mới. Nếu đúng là yêu cầu (không phải câu hỏi hay trò chuyện): HỎI người dùng một câu — chạy Intake Nhanh / Đầy đủ / Bỏ qua (CLAUDE.md Luật 0). Người dùng nói "còn nữa"/"gửi tiếp" thì chờ tới "xong" rồi mới hỏi. Đã chọn Bỏ qua cho chủ đề này thì không hỏi lại.');
  }

  if (notes.length) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: notes.join('\n') } }));
  }
});
