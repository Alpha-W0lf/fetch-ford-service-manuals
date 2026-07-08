#!/usr/bin/env python3
"""One-off: paste dealerconnection cookie header into templates/cookie_dc_paste.txt then run."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
paste = (ROOT / "templates/cookie_dc_paste.txt").read_text(encoding="utf-8").strip()
content = (
    "; CONTENT_PERMISSIONS=permissions=~WS.*|~WT.*|~WV.*|~WE.*|~WR.*|~WC.*|~WX.*"
    "|~URETAILER.*|~Diagnostics.*|~slts.*|~WD|~epdikeys|~WW.*"
    "&expiration=20260707100130"
    "&signature=nwhzphE1H0Z+a/08P4rcg5ndqX9Mx17IH16MA3+9mJk="
    "; CONTENT_AUTH=permissions=~WSGX|~WEGW"
    "&expiration=20260707091456"
    "&signature=LVYLMq4aX/YP5qASTHDXJit4wJv5J9aGIzSpr7ytiCc="
)
out = ROOT / "templates/cookieString.txt"
out.write_text(paste + content, encoding="utf-8")
print(f"Wrote {out} ({len(paste) + len(content)} chars)")
print("Has Ford.TSO.PTSSuite:", "Ford.TSO.PTSSuite" in paste)
