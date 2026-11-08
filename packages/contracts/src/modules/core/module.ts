// CR-125 · module `core`: khai báo ở `./index.ts` (sổ tự sinh nhập `./core`). File này liệt kê node có thư mục riêng `<node>/node.ts`
// (khuôn module:new) để `check:modules` đối chiếu được.
export { CORE_MODULE } from "./index";
export { START_FORM_NODE } from "./start-form/node";
