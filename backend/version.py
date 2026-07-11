from pathlib import Path

# In Docker the build context is ./backend, so VERSION lives alongside this file.
# Locally it's one directory up (repo root). Try local first, fall back to parent.
def get_version() -> str:
    for candidate in (
        Path(__file__).resolve().parent / 'VERSION',
        Path(__file__).resolve().parent.parent / 'VERSION',
    ):
        if candidate.exists():
            return candidate.read_text().strip()
    return '0.0.0'

APP_VERSION = get_version()
API_VERSION = 'v1'
