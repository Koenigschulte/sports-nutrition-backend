# AGENTS.md — Sports Nutrition Backend
> Basisregeln unten übernommen aus `_AGENTS_BASE.md` (`C:\Users\Alexa\OneDrive\Dokumente\Claude\Projects\_AGENTS_BASE.md`). Bei globalen Regeländerungen dort aktualisieren und synchronisieren.
> Diese Datei ist die EINZIGE Steuerdatei für dieses Repo — für Claude Code UND Codex. `CLAUDE.md` importiert sie nur (`@AGENTS.md`). Änderungen immer hier eintragen, nie in CLAUDE.md direkt.

---

## PROJEKTSPEZIFISCH — Sports Nutrition Backend

- **Zweck:** Private Ernährungs-App — Backend
- **URL:** https://nutrition.koeschu.com (Backend), https://app.nutrition.koeschu.com (Frontend/SPA)
- **GitHub:** https://github.com/Koenigschulte/sports-nutrition-backend
- **Health-Endpoint:** `https://nutrition.koeschu.com/api/health`
- **Hosting:** Hetzner CX33 + Coolify 4
- **Deploy-UUID (Coolify, Backend):** `g63a8gexq0u68lk9j04v4ffa`
- **Deploy:** `sudo /usr/local/bin/ops-deploy-nutrition` via SSH als `claude-ops`
- **Frontend:** separates Repo `sports-nutrition-app` (SPA, nginx:alpine via Coolify), Branch `master`
- **Datenbank:** Hetzner PostgreSQL (dedizierter Server `postgres-standalone`, Private IP `172.20.0.3`, seit 05.07.2026 — vorher Coolify-Container `pp8k3d59ezxug7o5v34zokby`)
- **Monitoring:** Better Stack Monitor 4458032 → `/api/health`, Watchdog (`watchdog.py`) + `server-alert.py` auf dem Server

### ⚠️ WICHTIG — Credential-Vorfall (03.07.2026)
- Der ursprüngliche lokale Clone (`Sports_Nutrition_App/backend/` unter `Projects\`) hatte einen GitHub Personal Access Token im Klartext in der `git remote`-URL — kompromittiert.
- **TODO (steht in `CLAUDE.md` → "Offene Punkte"):** Token bei GitHub rotieren (Settings → Developer settings → Personal access tokens).
- Dieser AGENTS.md-Commit wurde bewusst über einen separaten, sauberen Klon (`gh repo clone`, GitHub-CLI-Auth) gepusht, um den kompromittierten Token nicht zu verwenden.
- Repo-Sichtbarkeit wurde am 03.07.2026 von Public auf **Private** umgestellt.

---

