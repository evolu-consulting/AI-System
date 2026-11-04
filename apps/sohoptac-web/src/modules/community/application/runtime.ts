// Mặt tiền ứng dụng cho chế độ API: `ui`/entry không import `adapters` trực tiếp (luật web-ui-no-adapters), đi qua đây.
export { type Api, apiMode, createApi } from "../adapters";
