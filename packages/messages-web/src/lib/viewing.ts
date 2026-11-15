// CR-132 · sửa lỗi review · hội thoại «đang xem» (khung chat đang mở và tab hiển thị): tin tới khi đang xem không cộng chưa đọc.
// Đếm theo id: đổi hội thoại (mở B trước khi A kịp dọn) không bị dọn nhầm; chỉ xoá khi đúng id đang giữ.
export type Viewing = {
  enter: (id: string) => void;
  /** Chỉ xoá khi `current === id` (cleanup của hội thoại cũ chạy sau khi hội thoại mới đã đặt thì không làm mất). */
  leave: (id: string) => void;
  current: () => string | null;
};

export function createViewing(): Viewing {
  let cur: string | null = null;
  return {
    enter: (id) => {
      cur = id;
    },
    leave: (id) => {
      if (cur === id) cur = null;
    },
    current: () => cur,
  };
}
