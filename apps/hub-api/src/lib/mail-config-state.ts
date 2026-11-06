// CR-121 c21 · cờ trong tiến trình: lần đọc cấu hình mail gần nhất từ kho secret có KHÔNG đọc được (sai định dạng/kiểu cũ) hay không.
// Ghi bởi notify (`mailConfigReader`), đọc bởi ops check `notify_config` — check không giải mã secret nên cần tín hiệu này. Chỉ lưu
// mã cố định `mail_config_invalid`, không bao giờ giá trị. Mỗi instance Hub giữ cờ riêng; cờ chỉ đổi khi có lần gửi/đọc.
let invalid = false;
export const MAIL_CONFIG_INVALID_CODE = "mail_config_invalid";
export const setMailConfigInvalid = (v: boolean): void => {
  invalid = v;
};
export const isMailConfigInvalid = (): boolean => invalid;
