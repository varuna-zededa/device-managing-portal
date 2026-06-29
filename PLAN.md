# Device Managing Portal — Implementation Plan

Full product spec: see [DESIGN.md](DESIGN.md)
Repo: https://github.com/varuna-zededa/device-managing-portal

---

## Current Status

> **Awaiting feedback from management and team before full implementation begins.**

---

## Completed

- [x] **Design document** — Full product specification: data models, API surface, UI behaviour, auth
  flow, reservation flow, encryption, deployment, and decisions log
- [x] **Interactive wireframes** — Static HTML mockups covering the full UI surface; clone the repo
  and open any file in `wireframes/` directly in a browser — no build step required
  - `index.html` — Device list (member view): table, search & filter bar, expand panel, ownership
    actions, condition colour-coding, notification bell
  - `admin_index.html` — Device list (admin view): force-assign, delete, admin-only action items
  - `modals.html` — All dialogs: Add Device, Edit Device (with read-only serial number + condition
    picker), Fetch Status (normal / 403 / 404 states), Reserve (unowned + owned flows)
  - `states.html` — Loading skeleton, empty, no-results, load-error, and stale-data states
  - `confirm.html` — Reservation approval page (`/confirm/:token`): Approve / Reject buttons
  - `users.html` — Admin user management page

---

## Pending (not started)

- [ ] **Backend** — Django + DRF: models, migrations, API endpoints, ZedCloud status fetch,
  Fernet encryption, `django.core.mail` email, reservation approval flow, ownership history
- [ ] **Frontend** — React + Vite + Tailwind: all components and pages as per wireframes; axios
  client with `X-User-Email` header; `UserContext` + localStorage session; auto-refresh
- [ ] **Docker setup** — `docker-compose.yml`, `backend/Dockerfile`, `frontend/Dockerfile`,
  `nginx.conf`, `entrypoint.sh` (migrate + seed + gunicorn)
- [ ] **Seed data** — `clusters_seed.json` for the 6 pre-seeded clusters
