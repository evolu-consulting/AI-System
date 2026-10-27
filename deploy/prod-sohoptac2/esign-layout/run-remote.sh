# Chay kiem bo cuc trong hub-api (phong bi nhap, khong gui email). Dau vao: /tmp/lc/{server-check.ts,sign.html,offset.json}
cd ~/workspace/sohoptac2
C=$(docker compose -p sohoptac2 ps -q hub-api)
docker cp /tmp/lc/server-check.ts "$C":/tmp/server-check.ts >/dev/null
docker cp /tmp/lc/sign.html "$C":/tmp/sign.html >/dev/null
docker cp /tmp/lc/offset.json "$C":/tmp/offset.json >/dev/null
docker compose -p sohoptac2 exec -T hub-api sh -c 'bun --env-file=/run/s2/app.env /tmp/server-check.ts; rm -f /tmp/server-check.ts /tmp/sign.html /tmp/offset.json' | grep -E '^LAYOUT'
