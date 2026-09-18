#!/usr/bin/env bash
# One-shot setup for solspot.fun on a fresh Ubuntu 24.04 droplet.
# Run as root:   bash /opt/spot/deploy/setup.sh
set -euo pipefail

DOMAIN=solspot.fun
APP=/opt/spot
PORT=8787

say() { echo; echo "=== $* ==="; }

say "packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq curl ca-certificates gnupg nginx ufw certbot python3-certbot-nginx >/dev/null

say "node 22"
if ! command -v node >/dev/null || [[ "$(node -v)" != v22* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
node -v

say "swap (1GB, cheap insurance on a small box)"
if [ ! -f /swapfile ]; then
  fallocate -l 1G /swapfile && chmod 600 /swapfile && mkswap /swapfile >/dev/null && swapon /swapfile
  grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
free -h | head -2

say "build the site"
cd "$APP"
# node_modules uploaded from Windows is useless here: NTFS carries no execute
# bit, so node_modules/.bin/vite arrives unrunnable ("vite: Permission denied"),
# and the binaries are the wrong platform anyway. Always install natively.
if [ -d node_modules ] && [ ! -x node_modules/.bin/vite ]; then
  echo "node_modules came from another platform, reinstalling"
  rm -rf node_modules package-lock.json
fi
npm install --no-audit --no-fund
# the API lives under the same domain, so the browser never makes a cross-origin
# request and CORS stops being something that can break
NODE_OPTIONS=--max-old-space-size=700 VITE_SPOT_API="https://$DOMAIN/api" npm run build
mkdir -p /var/www/$DOMAIN
cp -r dist/* /var/www/$DOMAIN/
chown -R www-data:www-data /var/www/$DOMAIN

say "state and uploads live outside the build, so redeploys never wipe them"
mkdir -p "$APP/server/data" "$APP/server/uploads"

say "systemd service"
cat > /etc/systemd/system/spot.service <<UNIT
[Unit]
Description=SPOT state server
After=network.target

[Service]
Type=simple
WorkingDirectory=$APP
ExecStart=/usr/bin/node $APP/server/server.js
Restart=always
RestartSec=3
Environment=NODE_ENV=production
Environment=PORT=$PORT
Environment=SPOT_ORIGINS=https://$DOMAIN,https://www.$DOMAIN
EnvironmentFile=-$APP/.env.server
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload

say "nginx"
cat > /etc/nginx/sites-available/$DOMAIN <<CONF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    root /var/www/$DOMAIN;
    index index.html;
    client_max_body_size 16M;

    location / { try_files \$uri \$uri/ /index.html; }

    # the live feed is server-sent events: no buffering, long timeout.
    # this block must come before /api/ or nginx will buffer the stream.
    location /api/events {
        proxy_pass http://127.0.0.1:$PORT/events;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 24h;
    }

    # the API, same origin so there is no CORS to get wrong.
    # the trailing slash strips /api before it reaches node.
    location /api/ {
        proxy_pass http://127.0.0.1:$PORT/;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # uploads go through node so its nosniff/CSP headers survive
    location /uploads/ {
        proxy_pass http://127.0.0.1:$PORT/uploads/;
        proxy_set_header Host \$host;
    }
}
CONF
ln -sf /etc/nginx/sites-available/$DOMAIN /etc/nginx/sites-enabled/$DOMAIN
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

say "firewall"
ufw allow OpenSSH >/dev/null
ufw allow 'Nginx Full' >/dev/null
ufw --force enable >/dev/null
ufw status | head -6

say "https certificate"
certbot --nginx -d $DOMAIN -d www.$DOMAIN --non-interactive --agree-tos \
  --register-unsafely-without-email --redirect || {
  echo "certbot failed - is DNS pointing here yet? check with: dig +short $DOMAIN"
}

echo
echo "-------------------------------------------------------"
echo " Built, and nginx is serving https://$DOMAIN"
echo
echo " The state server is deliberately NOT started: it refuses"
echo " to run without the token address, so nobody can claim"
echo " spots for free before launch."
echo
echo " When you have the CA from pump.fun:"
echo "   nano $APP/.env.server        # add the three lines below"
echo "     SPOT_MINT=<the CA>"
echo "     SPOT_RPC=<your helius url>"
echo "     SPOT_ADMIN_TOKEN=<a long secret>"
echo "   chmod 600 $APP/.env.server"
echo "   systemctl enable --now spot"
echo "   systemctl status spot --no-pager"
echo "-------------------------------------------------------"
