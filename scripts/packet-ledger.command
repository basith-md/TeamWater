#!/bin/zsh
set -e
cd "$(dirname "$0")/.."
printf '\033]0;Water Connect · Live Packet Ledger\007'
exec env -u PYTHONPATH .venv/bin/python -u scripts/packet-ledger.py
