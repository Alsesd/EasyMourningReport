""" Launcher for the app """
import sys
if hasattr(sys.stdout, "reconfigure"):
   sys.stdout.reconfigure(encoding="utf-8", errors="replace")
   sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    
import uvicorn

from app.db import DB_PATH
from app.main import app



def server_start(DB_PATH, HOST="127.0.0.1", PORT="8000");
    print(f"Data folder: {DB_PATH.parent}", flush=True)
    uvicorn.run(
        app,
        host=HOST,
        port=int(PORT)
   )

