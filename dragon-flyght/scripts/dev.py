#!/usr/bin/env python3
"""Start both services and terminate owned children together on Ctrl-C."""
import subprocess, sys, time, signal
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
children=[]
def stop(*args):
    for child in children:
        if child.poll() is None:child.terminate()
    for child in children:
        try:child.wait(timeout=5)
        except subprocess.TimeoutExpired:child.kill()
    sys.exit(0)
signal.signal(signal.SIGINT,stop);signal.signal(signal.SIGTERM,stop)
try:
    children.append(subprocess.Popen([str(ROOT/'.venv/bin/python'),'-m','uvicorn','backend.main:app','--host','127.0.0.1','--port','8000'],cwd=ROOT))
    children.append(subprocess.Popen(['npm','run','dev','--','--port','5173','--strictPort'],cwd=ROOT/'frontend'))
    print('\nDragonfly AI → http://127.0.0.1:5173\nAPI docs → http://127.0.0.1:8000/docs\nCtrl-C stops both services.\n',flush=True)
    while all(c.poll() is None for c in children):time.sleep(.5)
finally:stop()
