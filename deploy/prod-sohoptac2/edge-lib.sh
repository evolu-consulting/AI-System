#!/usr/bin/env bash
# sohoptac2 - ham dung chung cho enable-domain.sh / cutover.sh (source, khong chay truc tiep).

# s2_names <chat|admin|hub|community|app> <base> <test|both>  -> danh sach host cho server_name
s2_names() {
  local p t
  case "$1" in
    chat) p=ai; t=ai-test ;;
    admin) p=ai-admin; t=ai-test-admin ;;
    hub) p=ai-hub; t=ai-test-hub ;;
    app) p=app; t=app-test ;;   # CR-119: host DUY NHAT cua web gop (SHT o goc, Community o /community); host sohoptac[-test] da bo (quyet dinh 2026-11-05)
    community) p=community; t=community-test ;;   # CR-118: host CU, chi con 301 ve app[-test].<d>/community (khop nginx.conf map $s2_main_origin)
    *) return 2 ;;
  esac
  case "$3" in
    test) echo "$t.$2" ;;
    both) echo "$p.$2 $t.$2" ;;
    *) return 2 ;;
  esac
}

# s2_render <src> <base> <test|both> <listen>  -> conf ra stdout
# CR-119 (quyet dinh 2026-11-05): app[-test].<d> la host web gop DUY NHAT; sohoptac[-test].<d> khong con duoc dung (khong server_name, khong 301).
# community[-test].<d> giu 301 co dinh ve app[-test].<d>/community (dich tu base, KHONG tu Host client; moc go ~2026-12-05, xem nginx.conf).
s2_render() {
  local mp="https://app.$2" mt="https://app-test.$2"
  sed -e "s/__N_CHAT__/$(s2_names chat "$2" "$3")/" \
      -e "s/__N_APP__/$(s2_names app "$2" "$3")/" \
      -e "s/__N_ADMIN__/$(s2_names admin "$2" "$3")/" \
      -e "s/__N_HUB__/$(s2_names hub "$2" "$3")/" \
      -e "s/__N_COMMUNITY__/$(s2_names community "$2" "$3")/" \
      -e "s#__MAIN_PROD__#$mp#g" -e "s#__MAIN_TEST__#$mt#g" \
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
