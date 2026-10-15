# SHIM UAT (không phải code sản phẩm): BUG2 — hub-api production (server.ts) không có vòng nền gọi `sweepOnce` (chỉ
# `postThread`/`khWriter` được `poster.start`) ⇒ `advanceApply` (mở PR) không bao giờ chạy. Sinh `uat-server.ts` = server.ts +
# `onProcessHandles` gọi sweepOnce mỗi 3s (import tuyệt đối). KHÔNG sửa server.ts.
R=D:/AI/ai-system/apps/hub-api
sed -e "s|from \"\.\./package.json\"|from \"$R/package.json\"|" -e "s|from \"\./|from \"$R/src/|" \
  -e "s|signal: stop.signal,|signal: stop.signal, onProcessHandles: (h) => { console.log('uat-sweep hook'); setInterval(() => { void h.sweepOnce().then((r) => { if (r.queued + r.interrupted + r.expired) console.log('uat-sweep', JSON.stringify(r)); }).catch((e) => console.error('uat-sweep', String(e))); }, 3000); },|" \
  $R/src/server.ts > D:/AI/ai-system/docs/specs/P-c2-pr/evidence/2026-10-15/scripts/uat-server.ts
