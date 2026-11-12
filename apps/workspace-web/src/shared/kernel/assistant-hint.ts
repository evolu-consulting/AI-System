// Gợi ý ngữ cảnh trang cho trợ lý chung: trang (vd Bảng tin Cộng đồng) đặt từ khoá đang tìm; trợ lý đọc khi gửi. Kho nhỏ, không React.
let selection: string | null = null;

export const setAssistantSelection = (s: string | null): void => {
  selection = s;
};
export const getAssistantSelection = (): string | null => selection;
