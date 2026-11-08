#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then python3 -m venv .venv; fi
if ! .venv/bin/python -c 'import fastapi,pandas,sklearn,httpx,dotenv' >/dev/null 2>&1; then .venv/bin/pip install -r requirements.txt; fi
if [ ! -d frontend/node_modules ]; then (cd frontend && npm ci); fi
exec .venv/bin/python scripts/dev.py
