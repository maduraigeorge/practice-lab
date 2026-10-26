#!/usr/bin/env sh
cd "$(dirname "$0")" || exit 1
python3 -m pip install -q -r requirements.txt
exec python3 server.py
