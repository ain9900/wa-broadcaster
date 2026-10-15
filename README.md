# WA Broadcaster

Link WhatsApp accounts by scanning a QR code, then send one message to many **contacts** (individual recipients), shared out across those accounts, safely paced, scheduled and tracked.

> **Important:** this uses an unofficial WhatsApp Web connection (Baileys, or Evolution API, which is built on it). That is against WhatsApp's terms, and numbers can be banned, especially for fast or bulk sending. Only message people who expect it, keep waits between messages at 8 seconds or more, and test with a number you can afford to lose.

## Features

- **Accounts:** link any number of WhatsApp accounts by QR code. Logins are kept and reconnect by themselves. Per-account daily limits.
- **Contacts:** save numbers with names, organise them into lists, import from a pasted list or CSV (Excel / Google Sheets), and export to CSV. Local numbers like `017…` get your default country code. Opted-out contacts are never messaged.
- **WhatsApp check:** imported numbers are checked for WhatsApp in the background through a connected account. Numbers that aren't on WhatsApp are left out of broadcasts, and you can filter by the result or re-check numbers.
- **Recipients:** pick contact lists, single contacts or paste numbers. Each number is checked for WhatsApp before sending. `{name}` (or `{name|friend}` with a fallback) puts each person's name in the message.
- **Composer:** WhatsApp formatting (bold, italic, strike, mono) with a live chat-bubble preview, attachments up to 25 MB (photo, video, GIF, audio, document), attach by link, and templates.
- **Sender rotation:** choose which accounts send. They can take turns (N messages each), be picked at random, or go by fewest sent today. With failover, an account that disconnects or reaches its daily limit is passed over.
- **Safe sending:** one message at a time, a random wait in your range, optional breaks after every N messages, "typing…" before each message, and daily limits per account.
- **Scheduling and queue:** send now or at a set time. Sends queue and run one after another.
- **Live campaign status:** open a campaign to see who is being sent to right now, who's next, a countdown, sent/failed/skipped/waiting counts, and time left.
- **Control:** pause, resume, cancel, and "retry failed" for any campaign. A crash or restart resumes where it stopped, without double-sending.
- **Dashboard:** live progress, today's numbers, and the last 7 days.
- **Reports:** pick a date range to see totals, delivery rate, messages per day, results by account and by campaign, plus the most common failure reasons. Download as CSV, or download one campaign's full recipient report.
- **Separate workspaces:** every user has their own WhatsApp accounts, contacts, lists, campaigns, templates, settings and reports. Nobody sees another user's data. Each workspace sends one campaign at a time; different workspaces send side by side.
- **Team members:** in **Settings → Team**, a user adds employees or support assistants with their own sign-in. They work in that user's workspace and can do all the work, except add people or change passwords (the owner resets theirs).
- **Sign-up:** with `ALLOW_SIGNUP=true` in `.env`, the sign-in page shows **Create an account**. Leave it `false` on a public server unless strangers may sign up; you can always add users in the admin panel at `/admin/`.

## Architecture

```
 Browser ──► React UI (Vite / Nginx) ──/api──► Django REST API ──► PostgreSQL
                                                   │    ▲
                                    Celery beat ──►│    │ webhooks (connection changes)
                                    Celery worker ─┤    │
                                     (Redis broker)│    │
                                                   ▼    │
                                     WhatsApp provider (WA_PROVIDER)
                                     ├─ builtin:   ./gateway  (Node + Baileys, internal HTTP API)
                                     └─ evolution: Evolution API v2
```

| Folder | What it is |
|---|---|
| `backend/` | Django 5 + Django REST Framework. Apps: `core` (auth, sign-up, team members, per-user settings, dashboard), `whatsapp` (accounts, providers), `contacts` (numbers, lists, import/export), `broadcasts` (campaigns, sending engine, sender rotation, reports, templates, media). |
| `gateway/` | Small Node service that holds the WhatsApp (Baileys) connections. Internal only, protected by `GATEWAY_API_KEY`. |
| `frontend/` | React + TypeScript + Vite single-page app. |
| `docker-compose.yml` | The full stack: Postgres, Redis, Django (gunicorn), Celery worker and beat, gateway, Nginx serving the UI, and optionally Evolution API. |
| `scripts/` | `setup` and `dev` helpers for running without Docker. |
| `deploy/` | Host Nginx config for HTTPS on a VPS. |

**How sending works:** Celery beat checks every 5 seconds for a due campaign and hands it to a worker. The worker picks the sending account (following the rotation), sends to one contact, saves the result in the database, waits, and moves to the next contact. All progress lives in Postgres, so pausing, cancelling, a restart or a crash never loses track. A message that was mid-send during a crash is marked "may or may not have arrived" rather than sent twice.

---

## 1. Run with Docker (recommended)

Install **Docker Desktop** (Windows/Mac) or Docker Engine (Linux), then:

```bash
cp .env.example .env          # Windows: copy .env.example .env
```

Edit `.env` and set at least `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `GATEWAY_API_KEY` and `ADMIN_PASSWORD` to long random values. Set `DJANGO_DEBUG=false`. (`node scripts/setup.mjs` can fill these in for you.)

```bash
docker compose up -d --build
```

Open **http://localhost:8080** and sign in as `admin` with your `ADMIN_PASSWORD`.

Useful commands:

```bash
docker compose ps                         # what's running
docker compose logs -f worker gateway     # watch sending and WhatsApp
docker compose exec backend python manage.py createsuperuser   # add another user
docker compose down                       # stop (data stays in Docker volumes)
```

## 2. Run without Docker (quick local development)

Needs **Node.js 20+** and **Python 3.11+**. No Postgres or Redis needed: it uses SQLite and a built-in worker.

```bash
npm run setup     # creates .env with random secrets, Python venv, database, npm packages
npm run dev       # starts gateway, Django, worker and the UI together
```

Open **http://localhost:5173**. `setup` prints the admin password (it's also in `.env` as `ADMIN_PASSWORD`).

To use Postgres and Redis locally instead, set `DATABASE_URL` and `REDIS_URL` in `.env`. `npm run dev` then runs a Celery worker instead of the built-in one.

Tests: `npm test` runs the backend test suite.

## 3. Link an account and send

1. **Accounts** → type a name → **Link a new account**.
2. On the phone: WhatsApp → **Settings** → **Linked devices** → **Link a device**, then scan the QR code.
3. After a few seconds it shows **Connected**.
4. **New broadcast** → write the message → pick contacts or lists (or paste numbers) → choose the accounts to send from → check the timing → **Send**.
5. Click the campaign to watch its live status.

To message individuals, first add numbers on the **Contacts** page (or paste them straight into the composer).

> Messaging people who haven't saved your number carries a high ban risk. Only message people who expect it, honour opt-outs, keep waits long, and start with small lists.

---

## 4. Deploy to a VPS (Ubuntu 22.04 / 24.04)

Point a domain's DNS **A record** (e.g. `wa.yourdomain.com`) at the VPS IP, then SSH in:

```bash
# Docker
curl -fsSL https://get.docker.com | sh

# the app
git clone <your repo> /opt/wa-broadcaster      # or: scp -r the folder (skip node_modules, .venv)
cd /opt/wa-broadcaster
cp .env.example .env && nano .env
```

In `.env` on the server:

- New long random values for `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `GATEWAY_API_KEY`, `ADMIN_PASSWORD`
- `DJANGO_DEBUG=false`
- `DJANGO_ALLOWED_HOSTS=wa.yourdomain.com`
- `DJANGO_CSRF_TRUSTED_ORIGINS=https://wa.yourdomain.com`
- `DJANGO_SECURE=true`
- `NUM_PROXIES=2` (host Nginx + the container's Nginx)
- keep `HTTP_BIND=127.0.0.1` (only the host Nginx can reach the app)

```bash
docker compose up -d --build
```

HTTPS with the host's Nginx and a free certificate:

```bash
apt install -y nginx certbot python3-certbot-nginx
cp deploy/nginx-host.conf /etc/nginx/sites-available/wa-broadcaster
sed -i 's/wa.yourdomain.com/YOUR.DOMAIN/' /etc/nginx/sites-available/wa-broadcaster
ln -s /etc/nginx/sites-available/wa-broadcaster /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
certbot --nginx -d YOUR.DOMAIN
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Containers restart by themselves after a reboot (`restart: unless-stopped`).

**Updating:** `git pull && docker compose up -d --build`. Migrations run automatically.

**Backups:** the database is `docker compose exec db pg_dump -U wab wab > backup.sql`. WhatsApp logins live in the `wa_sessions` volume and uploads in `media`.

---

## Using Evolution API instead of the built-in gateway

Evolution API is a popular, feature-rich WhatsApp server (also Baileys-based). To switch:

1. In `.env`: `WA_PROVIDER=evolution` and a long random `EVOLUTION_API_KEY`.
2. `docker compose --profile evolution up -d --build`
3. Link accounts again from the **Accounts** page. Each account becomes an Evolution "instance".

You can stop the built-in gateway (`docker compose stop gateway`) once you no longer use it. Accounts linked under one provider don't move to the other.

> The Evolution provider (`backend/apps/whatsapp/providers/evolution.py`) follows the Evolution API v2 docs, but has not been tested against a live Evolution server. Check it with a test number first.

## Configuration

Everything is in `.env`; `.env.example` documents each value. Sending defaults (waits, breaks, daily limit, typing indicator, sender rotation) are under **Settings** in the app, and each broadcast can change them.

## Keep it safe

- WhatsApp logins (the `wa_sessions` volume, or `gateway/sessions/` locally) give full access to those accounts. Never share or commit them.
- Never expose the gateway port (3100) or Redis/Postgres to the internet. Compose keeps them on the internal network.
- Use HTTPS (`DJANGO_SECURE=true`) and strong passwords on the VPS.
- To fully unlink an account, click **Remove**, or on the phone open **Linked devices** and log the device out.

## Troubleshooting

| Problem | Fix |
|---|---|
| QR code never appears / keeps reconnecting | WhatsApp changed its protocol. Update Baileys: `cd gateway && npm install @whiskeysockets/baileys@6`, then rebuild/restart. |
| "WhatsApp service is not reachable" banner | The gateway (or Evolution) isn't running. Check `docker compose logs gateway`. |
| "Not linked" | Nobody scanned the QR in time. Click **Show QR code**. |
| "Logged out from phone" | The device was removed on the phone. Click **Show QR code** and scan again. |
| Contacts stay "Not checked yet" | Checks run through a connected account. Link one and keep the worker running. |
| Campaign stuck on "Scheduled" | The worker or beat isn't running: `docker compose logs worker beat`. Without Docker, keep `npm run dev` open. |
