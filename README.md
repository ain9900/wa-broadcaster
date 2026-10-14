# Announcement Sender

Link WhatsApp accounts by scanning a QR code, then post one message to many groups across those accounts.

> **Important:** this uses an unofficial WhatsApp Web connection (the Baileys library). It is against WhatsApp's terms, and numbers can be banned, especially for fast or bulk sending. Post only to groups you are a real member of, keep the pause between groups at 8 seconds or more, and test with a number you can afford to lose.

## What it does

- **Password login:** one password protects the whole dashboard.
- **Accounts tab:** link a WhatsApp account by scanning a QR code. The login is saved, so it reconnects by itself after restarts. You can link several accounts.
- **Send tab:** write a message once (bold, italic and a preview included), tick groups from any connected account, then send. It posts one group at a time with a short "typing…" before each message.
- **Attachments:** a photo, video, audio or document (up to 25 MB). The message becomes its caption.
- **Timing:**
  - *Wait between groups*: a random time in your range, e.g. 10 to 25 seconds.
  - *Take a break after*: e.g. after every 10 groups, rest 5 minutes (0 = no breaks).
  - *When to send*: now or a chosen date and time. Sends wait in a queue and run one after another.
  - It shows roughly how long the whole send will take.
- **Daily limit per account** (Accounts tab): stop an account after N messages a day; extra groups are skipped and shown in History. Each account card shows how many it sent today.
- **Group sets:** save a selection of groups (e.g. "Staff") and pick it again in one tap.
- **History tab:** see what was sent, which groups failed or were skipped and why, and reuse a past message, file and groups.
- **Templates:** save messages you send often.

Scheduled sends only run while the server is running, so on your computer keep `npm start` open. On the VPS, PM2 keeps it running.

---

## 1. Run it on your computer (localhost)

You need **Node.js 20 or newer** (download from nodejs.org).

```bash
cd wa-broadcaster
npm install
cp .env.example .env        # on Windows: copy .env.example .env
```

Open `.env` and set:

- `ADMIN_PASSWORD`: your dashboard password
- `SESSION_SECRET`: any long random text. You can generate one with:
  `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Start it:

```bash
npm start
```

Open **http://localhost:3000**, sign in, and go to **Accounts**:

1. Type a name (e.g. "Office phone") and click **Link a new account**.
2. On the phone: WhatsApp → **Settings** → **Linked devices** → **Link a device**.
3. Scan the QR code on the screen. After a few seconds it shows **Connected** and loads the groups.

Then go to **Send**, write a message, tick some groups and click **Send**.

Stop the app with `Ctrl + C`. Your linked accounts stay saved in the `data/` folder.

---

## 2. Put it on your Hostinger VPS

These steps assume Ubuntu 22.04 or 24.04 (Hostinger's default VPS image) and a domain or subdomain, for example `wa.yourdomain.com`, whose DNS **A record** points to the VPS IP.

### a. Install Node.js, PM2 and Nginx

SSH into the VPS (`ssh root@YOUR_VPS_IP`), then:

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs nginx
npm install -g pm2
```

### b. Upload the app

From your computer (in the folder that contains `wa-broadcaster`):

```bash
scp -r wa-broadcaster root@YOUR_VPS_IP:/opt/
```

Don't upload `node_modules`. You can also upload `data/` if you want to keep the accounts you linked on localhost, but linking again on the server is cleaner.

On the VPS:

```bash
cd /opt/wa-broadcaster
npm install --omit=dev
cp .env.example .env
nano .env
```

In `.env` on the server, set a **strong** `ADMIN_PASSWORD`, a new `SESSION_SECRET`, keep `HOST=127.0.0.1`, and set `COOKIE_SECURE=true` (after HTTPS is working in step d).

### c. Keep it running with PM2

```bash
pm2 start server.js --name wa-sender
pm2 save
pm2 startup        # run the command it prints, so it starts after a reboot
```

Useful: `pm2 logs wa-sender`, `pm2 restart wa-sender`.

### d. Nginx and HTTPS

Create `/etc/nginx/sites-available/wa-sender`:

```nginx
server {
    listen 80;
    server_name wa.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

Enable it and add a free HTTPS certificate:

```bash
ln -s /etc/nginx/sites-available/wa-sender /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
apt install -y certbot python3-certbot-nginx
certbot --nginx -d wa.yourdomain.com
```

Now set `COOKIE_SECURE=true` in `.env` and run `pm2 restart wa-sender`. Open **https://wa.yourdomain.com**.

Optional firewall:

```bash
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

---

## Keep it safe

- The `data/sessions/` folder holds the WhatsApp logins. Anyone who copies it can use those accounts. Never share it or commit it to Git.
- Use a long dashboard password and HTTPS on the VPS.
- To fully unlink an account, click **Remove** in the dashboard, or on the phone go to **Linked devices** and log out of the device.

## Troubleshooting

- **QR code never appears / keeps reconnecting:** WhatsApp sometimes changes its protocol. Update the library: `npm install @whiskeysockets/baileys@latest`, then restart.
- **"Not linked" after a while:** nobody scanned the QR in time. Click **Show QR code**.
- **"Logged out from phone":** the device was removed on the phone. Click **Show QR code** and scan again.
- **A group shows "Can't post":** the group only lets admins send messages, and this account isn't an admin.
- **Send stopped in the middle after a restart:** a send that was running when the server stopped is marked "Interrupted". Use **Reuse** in History to send to the rest.
