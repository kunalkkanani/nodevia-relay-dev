# nodevia-relay-dev

A minimal WebSocket relay server for [nodevia-agent](https://github.com/kunalkkanani/nodevia-agent).

Agents connect over WebSocket. When a user opens a TCP connection (e.g. SSH), the relay forwards traffic through the WebSocket tunnel to the registered device.

> This is the **self-hosted relay**. Deploy it on any VPS and freelancers / hobbyists can use their own infrastructure.

---

## How it works

```
Device (agent) ──[WebSocket]──► relay ◄──[TCP/SSH]── you
```

The agent connects outbound — no port forwarding or VPN needed on the device side.

---

## Quick start (local dev)

```bash
npm install
npm start
```

The relay listens on:
- `:8080` — WebSocket (agents connect here)
- `:2222` — TCP tunnel (you connect here, e.g. `ssh -p 2222`)

---

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEVICE_TOKEN` | _(unset)_ | Secret token agents must send. **Set this in production.** |
| `TARGET_DEVICE_ID` | _(unset)_ | Route TCP connections to this specific device ID. If unset, routes to first connected device. |
| `TUNNEL_TARGET_PORT` | `22` | Port on the device that tunnel traffic forwards to |
| `WS_PORT` | `8080` | WebSocket server port |
| `TCP_PORT` | `2222` | TCP tunnel server port |

---

## Production deployment

### What you need

- A VPS (any provider — DigitalOcean, Hetzner, Vultr, etc.)
- A domain name pointing to your VPS IP
- Ports open: `80`, `443`, `2222` (public) — **never expose port 8080 directly**

---

### Step 1 — Install dependencies

```bash
# Node.js 20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs

# Nginx
sudo apt install -y nginx

# Certbot (Let's Encrypt)
sudo apt install -y certbot python3-certbot-nginx
```

---

### Step 2 — Clone and install the relay

```bash
git clone https://github.com/kunalkkanani/nodevia-relay-dev /opt/nodevia-relay
cd /opt/nodevia-relay
npm install --production
```

---

### Step 3 — Create a systemd service

```bash
sudo nano /etc/systemd/system/nodevia-relay.service
```

Paste this — replace `your-secret-token` with a strong random string (`openssl rand -hex 32`):

```ini
[Unit]
Description=Nodevia Relay
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/nodevia-relay
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=DEVICE_TOKEN=your-secret-token
Environment=WS_PORT=8080
Environment=TCP_PORT=2222
Environment=TUNNEL_TARGET_PORT=22

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
sudo systemctl daemon-reload
sudo systemctl enable nodevia-relay
sudo systemctl start nodevia-relay
sudo systemctl status nodevia-relay
```

---

### Step 4 — Nginx reverse proxy (TLS termination)

```bash
sudo nano /etc/nginx/sites-available/nodevia-relay
```

Replace `relay.yourdomain.com` with your domain:

```nginx
server {
    listen 80;
    server_name relay.yourdomain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
```

Enable and reload:
```bash
sudo ln -s /etc/nginx/sites-available/nodevia-relay /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

---

### Step 5 — TLS with Let's Encrypt

```bash
sudo certbot --nginx -d relay.yourdomain.com
```

Certbot auto-renews. Verify:
```bash
sudo certbot renew --dry-run
```

Your relay is now reachable at `wss://relay.yourdomain.com`.

---

### Step 6 — Firewall (ufw)

Only expose the ports you need. Never expose the raw WebSocket port (8080):

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp    # your SSH to manage the VPS
sudo ufw allow 80/tcp    # HTTP (certbot + nginx redirect)
sudo ufw allow 443/tcp   # HTTPS / WSS (Nginx)
sudo ufw allow 2222/tcp  # TCP tunnel port (users SSH through here)
sudo ufw enable
sudo ufw status
```

> Port `8080` is intentionally not in this list. The relay WebSocket is only accessible through Nginx on port `443`. No bot, scanner, or unauthorized client can reach it directly.

---

### Step 7 — Connect your agent

On the device (Raspberry Pi, Ubuntu server, etc.):
```bash
./nodevia-agent run \
  --relay-url wss://relay.yourdomain.com \
  --device-id my-pi \
  --token your-secret-token
```

Or via config file (`~/.config/nodevia/agent.toml`):
```toml
relay_url = "wss://relay.yourdomain.com"
device_id = "my-pi"
token     = "your-secret-token"
```

SSH in from anywhere:
```bash
ssh -p 2222 user@relay.yourdomain.com
```

---

## Multiple devices

To route a TCP connection to a specific device, set `TARGET_DEVICE_ID` in the systemd service:

```ini
Environment=TARGET_DEVICE_ID=my-pi
```

Or at runtime:
```bash
TARGET_DEVICE_ID=my-pi npm start
```

Without `TARGET_DEVICE_ID`, the relay routes to the first registered device.

---

## Security summary

| Layer | What it does |
|-------|-------------|
| `DEVICE_TOKEN` | Agents without the correct token are rejected before any tunnel opens |
| Nginx TLS (`wss://`) | All traffic is encrypted in transit |
| UFW firewall | Port 8080 (relay WebSocket) is never reachable from the internet |
| Port 2222 | Only expose if SSH tunneling is needed; remove from UFW otherwise |

---

## Logs

```bash
# Live logs
sudo journalctl -u nodevia-relay -f

# Last 100 lines
sudo journalctl -u nodevia-relay -n 100
```

---

## Release history

| Version | Description |
|---------|-------------|
| 0.3.0 | Token auth, named device routing, configurable ports, production deployment guide |
| 0.2.0 | TCP tunnel over WebSocket |
| 0.1.0 | WebSocket relay, register/ack protocol |
