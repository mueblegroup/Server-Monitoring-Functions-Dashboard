# Orbit · Server Monitoring & Functions Dashboard

A private, PhoneBox-inspired control center. Responsive phone/tablet/desktop layouts and swipeable Overview, Proxmox, Hestia, Cloudflare, Hostinger, Media, Activity and Connections pages. Original implementation; no PhoneBox source or assets copied.

## Run

Requires Node.js 22.13+ (Node 24 LTS recommended). No npm dependencies or frontend build. Uses built-in SQLite (experimental warning on Node 22).

```sh
cp .env.example .env
# Set ADMIN_EMAIL and a unique ADMIN_PASSWORD (14+ characters).
npm start
```

Open http://localhost:3000. Without admin configuration, a read-only demo is available. No default password. Demo resources are labeled and never substituted for failed live requests.

`PUBLIC_ORIGIN` must exactly match the browser origin, including scheme and port. For mobile/LAN deployment use an HTTPS reverse proxy, set `PUBLIC_ORIGIN=https://your-domain.example`, `COOKIE_SECURE=true`, and bind `HOST=0.0.0.0` if required. Never expose public HTTP.

## Deployment

Use a small unprivileged Debian/Ubuntu CT with Node 24, or Docker:

```sh
docker compose up -d --build
```

Compose binds port 3000 on loopback. Point your HTTPS proxy/cloudflared at it. Persist and back up the `orbit-data` volume. Docker runs as an unprivileged user with capabilities dropped. Direct Node deployments must preserve `data/` and use a dedicated service account. Restart after changing environment configuration. Never commit `.env` or SQLite data. Install a private CA with `NODE_EXTRA_CA_CERTS` for self-signed services; TLS verification stays enabled.

## Authentication

Scrypt password hashing, server-side sessions, hashed session IDs, CSRF protection, exact origin checks, login throttling, HttpOnly/SameSite cookies. Remembered login lasts 90 days; unchecked login lasts 12 hours. Logout revokes sessions. Only the bootstrap administrator is currently provisioned; public registration, MFA, password recovery, and user management are future work.

Bootstrap credentials apply only to an empty users table. Changing ADMIN_PASSWORD does not change an existing account. For recovery: stop Orbit, back up SQLite, remove the administrator's sessions and user row using a SQLite administrator, then restart with new bootstrap credentials. Audit and webhook tables can be preserved. All accounts currently have administrator privileges; provision trusted administrators only.

## Integration coverage

| Service | Implemented | Requirements / limits |
| --- | --- | --- |
| Proxmox | CT/VM listing, CPU/RAM, IP discovery, start/reboot/shutdown/stop/remove, configurable CT/VM creation | URL including port 8006; scoped token ID `user@pve!orbit` and secret. CT uses existing template, DHCP and unprivileged mode. VM uses existing ISO for manual OS installation. QEMU IP discovery requires guest agent. Returns task ID; refresh to verify completion. |
| Hestia | Users/domains, add/remove sites, Let's Encrypt, force HTTPS, enable HSTS | Access/secret key pair and IP allowlist. Issue certificate before HTTPS redirect/HSTS. Public DNS/challenge access required. |
| Cloudflare | Tunnel status/connections, hostname ingress plus proxied DNS CNAME | Existing remotely managed tunnel, account tunnel edit/read and zone DNS edit. Supply zone ID in form. Existing config preserved. `127.0.0.1` refers to cloudflared's host. DNS and ingress are separate operations; partial failure reports the created record for manual repair. No tunnel installation/deletion. |
| Hostinger | VPS listing/state/returned resource information, start/restart/stop | API token. Historical CPU/network charts, backups and remaining hPanel functions are not included. |
| Jellyfin | Random movie suggestions with year/rating/overview | URL and API token. No playback or Plex adapter in this phase. |
| pfSense | Throughput widget using a private collector | Collector must return `{"downloadMbps":100,"uploadMbps":20}` using firewall interface counters. Set URL and bearer token. Collector/direct pfSense adapter is not included until edition/API package is known. |
| Stripe | Signed, timestamp-checked, deduplicated webhook feed | Set STRIPE_WEBHOOK_SECRET; register public HTTPS `/api/stripe/webhook`. Values shown as minor units to avoid currency-decimal assumptions. No billing administration. |
| Weather | Current-location weather via Open-Meteo | Explicit location button, HTTPS/localhost. Coordinates sent to weather provider, not stored in SQLite. |
| YouTube Music | Official player launcher | Embedded playback and remote controls not implemented. |

Secrets are server environment variables listed in `.env.example`; they never reach browser storage. Connections are checked on page entry/manual refresh, not continuously polled. Clock updates each second. Asynchronous operation acceptance is audited, not provider task completion. Service-specific tokens must have least privilege and network reachability.

Set `SERVER_TLS_VERIFY=false` in `.env` to skip certificate chain and hostname verification for Proxmox, Hestia, Jellyfin and the pfSense collector, including self-signed certificates and connections by IP address. Restart Orbit after changing it. HTTPS still encrypts these connections, but does not authenticate the server certificate in this mode. Cloudflare, Hostinger and weather requests keep normal certificate verification. The default is `true`; do not use the process-wide `NODE_TLS_REJECT_UNAUTHORIZED=0` setting.

Hestia command profile:

```text
v-list-users,v-list-web-domains,v-add-web-domain,v-delete-web-domain,v-add-letsencrypt-domain,v-add-web-domain-ssl-force,v-add-web-domain-ssl-hsts
```

Use your Proxmox version's API viewer to assign node/storage/resource permissions for the operations needed. No arbitrary commands or API paths are accepted. Mutations require confirmation; resource deletion additionally asks for its identifier.

## Verification

```sh
npm test
node --check server.mjs
node --check services.mjs
node --check public/app.js
```

Tests cover private routes, login/origin safeguards, 90-day cookies, CSRF, confirmation, GET mutation restrictions, failed-action auditing, webhook signing/deduplication, secret exposure and logout. Live credentials are absent: validate read-only calls first, then use disposable resources to verify mutations.

Phase one is not production-verified against your services. Remaining: actual provider payload validation, account management/MFA/recovery, provider task tracking, scheduled monitoring, a pfSense collector matched to your installation, and a widget layout editor.

## References

- [PhoneBox inspiration](https://ersinkoc.github.io/phonebox/)
- [Proxmox API](https://pve.proxmox.com/pve-docs/api-viewer/)
- [Hestia REST API](https://hestiacp.com/docs/server-administration/rest-api) and [commands](https://hestiacp.com/docs/reference/cli)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Hostinger API](https://developers.hostinger.com/)
- [Jellyfin API](https://api.jellyfin.org/)
- [Open-Meteo](https://open-meteo.com/en/docs)
- [Stripe signatures](https://docs.stripe.com/webhooks/signature)

