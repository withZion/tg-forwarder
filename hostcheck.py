"""Run this on the host to see whether it can run the forwarder.

Copy it over, then: python3 hostcheck.py
Uses only the standard library, so it runs before anything is installed.
"""

import os
import socket
import sys
import tempfile

# Telegram MTProto data centres. The client picks one at runtime; reaching any
# of them is enough to prove outbound 443 is not filtered.
DCS = [
    ("DC2 Amsterdam", "149.154.167.51", 443),
    ("DC4 Amsterdam", "149.154.167.91", 443),
    ("DC1 Miami", "149.154.175.53", 443),
]

results = []


def check(name, ok, detail):
    results.append((name, ok, detail))
    print(f"[{'PASS' if ok else 'FAIL'}] {name}: {detail}")


v = sys.version_info
check(
    "Python 3.9+",
    v >= (3, 9),
    f"found {v.major}.{v.minor}.{v.micro} at {sys.executable}",
)

check(
    "venv module",
    __import__("importlib.util", fromlist=["util"]).find_spec("venv") is not None,
    "present" if __import__("importlib.util", fromlist=["util"]).find_spec("venv") else "missing",
)

reachable = []
for label, host, port in DCS:
    try:
        with socket.create_connection((host, port), timeout=8):
            reachable.append(label)
    except OSError:
        pass
check(
    "Outbound to Telegram :443",
    bool(reachable),
    ", ".join(reachable) if reachable else "all data centres refused or timed out",
)

data_dir = os.path.join(os.getcwd(), "data")
try:
    os.makedirs(data_dir, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=data_dir, delete=True) as f:
        f.write(b"x")
    writable = True
    detail = f"{data_dir} is writable"
except OSError as e:
    writable = False
    detail = f"{data_dir}: {e}"
check("Writable data directory", writable, detail)

try:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    bound = s.getsockname()[1]
    s.close()
    check("Can bind a local port", True, f"bound 127.0.0.1:{bound}")
except OSError as e:
    check("Can bind a local port", False, str(e))

failed = [n for n, ok, _ in results if not ok]
print()
if failed:
    print("Not ready. Failing checks: " + ", ".join(failed))
else:
    print("All automated checks passed.")
print(
    "Still to confirm by hand: that the host lets a process run indefinitely.\n"
    "  nohup sleep 900 >/dev/null 2>&1 &\n"
    "Come back in 15 minutes and run: pgrep -a sleep\n"
    "If it is gone, the host reaps background processes and cannot run this."
)
