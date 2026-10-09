#!/bin/bash
# Chạy trong WSL (user worker): bash run_all.sh  — dừng ngay khi một bước lỗi (không retry)
cd "$(dirname "$0")" || exit 1
python3 team_spike.py A 2 || exit 1
python3 team_spike.py B 1 || exit 1
python3 team_spike.py B 2 || exit 1
python3 team_spike.py C 1 || exit 1
python3 team_spike.py C 2 || exit 1
python3 team_spike.py redo 1 || exit 1
