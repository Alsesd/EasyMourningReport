"""Print the current OpenAPI document as JSON."""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.main import app  # noqa: E402

print(json.dumps(app.openapi(), ensure_ascii=False, indent=2))
