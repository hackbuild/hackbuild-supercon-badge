"""Prints the capsule machine's CREDIT_KEY, derived from the badge key the same way docs/lib/credit.js
does, and with a path writes it into the capsule firmware's secret.h.

    python3 -I tools/credit_key.py [../hackbuild-capsule-machine/firmware/capsule/secret.h]
"""
import hashlib
import hmac
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
key = json.loads((ROOT / "badge" / "secret.local.json").read_text())["key"]
credit = hmac.new(key.encode(), b"hackbuild capsule credit", hashlib.sha256).hexdigest()

if len(sys.argv) > 1:
    path = pathlib.Path(sys.argv[1])
    text = path.read_text()
    line = f'#define CREDIT_KEY "{credit}"'
    text = re.sub(r"#define CREDIT_KEY \"[0-9a-f]*\"", line, text) if "CREDIT_KEY" in text else text.rstrip() + "\n" + line + "\n"
    path.write_text(text)
    print("wrote CREDIT_KEY into", path)
else:
    print(credit)
