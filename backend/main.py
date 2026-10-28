"""Vercel/ASGI entrypoint for the Helium backend.

Vercel's FastAPI preset looks for an ``app`` object in ``main.py`` at the
service root. The actual application lives in ``app/main.py``; re-export it
here so both ``uvicorn main:app`` and Vercel's runtime can find it.
"""

from app.main import app

__all__ = ["app"]
