"""Entry point for local runs and for the compiled Windows exe (Nuitka).
The package must be imported (not run as a plain script) so that relative
imports inside app/ work and templates/static resolve correctly."""
import os

import uvicorn

from app.main import app

if __name__ == "__main__":
    uvicorn.run(app, host=os.getenv("HOST", "127.0.0.1"), port=int(os.getenv("PORT", "8000")))
