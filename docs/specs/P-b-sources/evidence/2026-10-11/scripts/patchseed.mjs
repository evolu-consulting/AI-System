import {readFileSync,writeFileSync} from "node:fs";
let s=readFileSync("seed-fixbug.mjs","utf8");
s=s.replace("const khung=bq(iKhung,iKhung+4);",
'// BỔ SUNG DUY NHẤT so với design (qc-uat): định dạng dòng trích dẫn mà checker Hub yêu cầu (`key:path@version`); design chưa nêu ⇒ mọi attempt bị template_invalid.\nconst FMT="Định dạng mỗi dòng trong `## Nguồn tham chiếu` (BẮT BUỘC, mỗi file đã đọc một dòng): `- ai-system-local:<đường-dẫn-trong-nguồn>@<phiên-bản ghi trong MANIFEST>` — đường dẫn tính từ gốc nguồn (không kèm `sources/ai-system-local/`), ví dụ `- ai-system-local:apps/hub-api/src/x.ts@<phiên-bản>`.";\nconst khung=bq(iKhung,iKhung+4)+"\n"+FMT;');
writeFileSync("seed-fixbug.mjs",s);
