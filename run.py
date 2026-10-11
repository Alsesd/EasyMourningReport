"""Entry point for local runs and for the compiled Windows exe (Nuitka).
The package must be imported (not run as a plain script) so that relative
imports inside app/ work and templates/static resolve correctly."""
import os

import uvicorn

from app.main import app
from app.models import DB_PATH

if __name__ == "__main__":
    print(f"Data folder: {DB_PATH.parent}", flush=True)
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
