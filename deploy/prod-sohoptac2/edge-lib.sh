#!/usr/bin/env bash
# sohoptac2 - ham dung chung cho enable-domain.sh / cutover.sh (source, khong chay truc tiep).

# s2_names <chat|contracts|admin|hub|community|app> <base> <test|both>  -> danh sach host cho server_name
s2_names() {
  local p t
  case "$1" in
    chat) p=ai; t=ai-test ;;
    contracts) p=sohoptac; t=sohoptac-test ;;
    admin) p=ai-admin; t=ai-test-admin ;;
    hub) p=ai-hub; t=ai-test-hub ;;
    app) p=app; t=app-test ;;   # CR-119: host trung tinh cua web gop (SHT o goc, Community o /community)
    community) p=community; t=community-test ;;   # CR-118: host CU, chi con 301 ve <sohoptac>/community (khop nginx.conf map $s2_main_origin)
    *) return 2 ;;
  esac
  case "$3" in
    test) echo "$t.$2" ;;
    both) echo "$p.$2 $t.$2" ;;
    *) return 2 ;;
  esac
}

# s2_render <src> <base> <test|both> <listen>  -> conf ra stdout
# CR-119: S2_APP_HOST_LIVE=1 (mac dinh 0) => sohoptac[-test].<d> va community[-test].<d> 301 sang app[-test].<d> (dich co dinh tu base, KHONG tu Host client);
# =0 => sohoptac.<d> van phuc vu web nhu cu, community.<d> 301 ve sohoptac.<d>/community, app.<d> phuc vu song song.
s2_render() {
  local live="${S2_APP_HOST_LIVE:-$(grep -m1 "^S2_APP_HOST_LIVE=" .env 2>/dev/null | cut -d= -f2-)}" mp mt lp lt   # env > .env (gen-env.sh) > 0
  live="${live:-0}"
  case "$live" in
    1) mp="https://app.$2"; mt="https://app-test.$2"; lp="$mp"; lt="$mt" ;;
    0) mp="https://sohoptac.$2"; mt="https://sohoptac-test.$2"; lp='""'; lt='""' ;;
    *) echo "s2_render: S2_APP_HOST_LIVE phai la 0|1" >&2; return 2 ;;
  esac
  sed -e "s/__N_CHAT__/$(s2_names chat "$2" "$3")/" \
      -e "s/__N_CONTRACTS__/$(s2_names contracts "$2" "$3")/" \
      -e "s/__N_APP__/$(s2_names app "$2" "$3")/" \
      -e "s/__N_ADMIN__/$(s2_names admin "$2" "$3")/" \
      -e "s/__N_HUB__/$(s2_names hub "$2" "$3")/" \
      -e "s/__N_COMMUNITY__/$(s2_names community "$2" "$3")/" \
      -e "s#__MAIN_PROD__#$mp#g" -e "s#__MAIN_TEST__#$mt#g" -e "s#__LEGACY_PROD__#$lp#g" -e "s#__LEGACY_TEST__#$lt#g" \
      -e "s/__BASE__/$2/g" -e "s/listen 80;/listen $4;/" "$1"
}

# s2_restore_confd <backup_dir> <confd>: dua noi dung conf.d ve dung ban sao luu (giu inode thu muc: co the la bind mount).
s2_restore_confd() {
  local bak="$1" dst="$2" f
  cp -pf "$bak"/* "$dst"/ 2>/dev/null || true
  for f in "$dst"/*; do
    [ -e "$f" ] || continue
    [ -e "$bak/$(basename "$f")" ] || rm -f "$f"
  done
}
