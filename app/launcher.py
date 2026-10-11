""" Launcher for the app """
import os
import sys
if hasattr(sys.stdout, "reconfigure"):
   sys.stdout.reconfigure(encoding="utf-8", errors="replace")
   sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    
import uvicorn
from app.main import app



def server_start(
    host: str = os.getenv("HOST", "127.0.0.1"),
    port: int = int(os.getenv("PORT", "8000")),
):
    uvicorn.run(app, host=host, port=port)


