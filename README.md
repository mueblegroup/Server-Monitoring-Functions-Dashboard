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

Phase one is not production-verified against your services. Remaining: actual provider payload validation, account management/MFA/recovery, provider task tracking, and scheduled monitoring.

## pfSense SNMP metrics

Orbit reads pfSense SNMP v2c directly; no metrics token, REST API package, or separate HTTP collector is required. On pfSense, enable **Services > SNMP**, MibII and Host Resources, bind to an internal interface, and allow UDP 161 from the Orbit container. Enable UCD as desired. Configure a private read community.

On Debian/Ubuntu, install the client tools with `apt install snmp`. The Docker image includes them. Set these in `.env`, then restart Orbit:

```dotenv
PFSENSE_SNMP_HOST=pfsense.wildoffice.lan
PFSENSE_SNMP_PORT=161
PFSENSE_SNMP_COMMUNITY=YOUR_READ_COMMUNITY
PFSENSE_SNMP_INTERFACE=pppoe2
```

Use the actual internet-facing interface name from **Status > Interfaces**; `pppoe2` is the initial default for this installation. Orbit discovers its current SNMP index by name on each poll, so it does not hardcode index 9. When a reconnect changes the interface name itself, update the setting. Do not add parent VLAN/physical-interface counters to PPPoE counters, as that double counts traffic.

The Overview network widget shows WAN receive/download and transmit/upload rates, interface status, mean CPU load from Host Resources, physical memory usage, and firewall uptime when exposed by SNMP. It polls every 5 seconds while visible; the first sample establishes a baseline and rates appear on the next poll. Values are SNMP samples, not an internet speed test. CPU and memory accounting may differ from the pfSense GUI. Missing metrics display as unavailable. Counter resets, reboots, interface index changes, and long sampling gaps rebaseline rates. 64-bit interface counters are preferred; a warning marks fallback to 32-bit counters, which can undercount across wraps on fast links.

The community remains server-side and is passed through a temporary owner-readable SNMP configuration file, not command arguments. No write SNMP operations are used. Existing `PFSENSE_METRICS_URL`/`PFSENSE_METRICS_TOKEN` collectors remain supported if direct SNMP is not configured.

## Customizable overview and host statistics

### Music and fullscreen

The music card is first on new layouts. Older layouts are promoted once when adding playlist support; afterward the normal Customize controls can move it. Choose **Connect playlist**, paste a YouTube Music/YouTube playlist Share link, and save. The playlist must be public or unlisted and allow embedding. Playback uses the YouTube privacy-enhanced embedded player with no autoplay; click Play. This connects a playlist, not the full YouTube Music account/library. No API key, password, cookies, or OAuth token is needed. Private playlists and restricted tracks may require opening the official YouTube Music app instead.

Use **Full screen** in the header for the browser Fullscreen API and screen-fit layout. Exit with the same button or Escape. Landscape orientation uses the extra width automatically; orientation is not forcibly locked. Browsers without Fullscreen API support can use their own fullscreen command or Add to Home Screen.

### Physical host temperature and fan sensors

Small temperature/fan badges appear in **Server health**. They show the highest reported temperature and fan RPM; tap either for individual labeled readings. These values require physical hardware sensors, not a VM's virtual CPU. The included Python collector reads Linux `/sys/class/hwmon` without running commands, installing sensor drivers, or accepting writes. Missing fan tachometer/temperature support remains unavailable.

From the Orbit container, copy the two deployment files to the Proxmox host:

```sh
cd /opt/orbit
scp deploy/host-sensors.py deploy/orbit-sensors.service root@10.16.1.153:/tmp/
```

On the **Proxmox host**:

```sh
install -d /opt/orbit-sensors
install -m 0644 /tmp/host-sensors.py /opt/orbit-sensors/host-sensors.py
install -m 0644 /tmp/orbit-sensors.service /etc/systemd/system/orbit-sensors.service
openssl rand -hex 32
nano /etc/orbit-sensors.env
```

Set the following, using the generated token:

```dotenv
SENSOR_HOST=10.16.1.153
SENSOR_PORT=9109
SENSOR_NODE=proxmox-main
SENSOR_TOKEN=YOUR_GENERATED_SECRET
```

```sh
chmod 600 /etc/orbit-sensors.env
systemctl daemon-reload
systemctl enable --now orbit-sensors
```

Keep TCP 9109 reachable only from the Orbit container on the internal network. This collector uses HTTP and bearer authentication; a trusted HTTPS reverse proxy can be used when needed. The service runs as `nobody`, with read-only system protection. On Orbit, add to `.env` and restart:

```dotenv
PROXMOX_SENSORS_URL=http://10.16.1.153:9109
PROXMOX_SENSORS_TOKEN=YOUR_GENERATED_SECRET
```

The collector's `SENSOR_NODE` must match the selected Proxmox node. A mismatched or unavailable collector will not replace CPU, memory, or storage data. This first collector configuration supports one physical host; selecting another node shows no hardware reading rather than presenting the wrong host's sensors.

The authenticated workspace defaults to **Fit screen** mode: cards are packed into viewport-sized screens, with Previous/Next buttons, horizontal swipes and arrow keys. Packing adapts to viewport width/height and preserves the chosen widget order and widths. At screen boundaries, swipes/arrow keys continue to the next service page. Resource lists, movies and activity lists have their own pagination. Oversized card details and dialogs remain internally scrollable so content is not clipped. Use **Expand view** in the header to restore the full scrolling layout; this display choice is remembered on the current device. Login remains a normal scrolling page.

Use **Customize** on Overview to show or hide widgets, move them up/down, and choose compact, half-width, or full-width cards. Cards stack on phones and use two columns on tablets. The layout, selected Proxmox node, and refresh interval are saved per account in SQLite and follow the user across browsers. **Reset layout** restores defaults when saved. Existing databases gain the preferences table automatically at startup.

Proxmox cards show selected host CPU usage/model/core count, memory and swap, uptime, load averages, root filesystem usage, storage pools, and CT/VM counts. Select the host from **Server**. Metrics refresh every 30 seconds by default, with manual/15/30/60-second options. Polling pauses when the browser tab is hidden and stops when leaving Overview. Failed polls mark previously displayed values as stale; storage errors do not discard available CPU/memory stats. Demo values are explicitly labeled. Host metrics need read access to `/nodes`, `/nodes/{node}/status`, `/nodes/{node}/storage` and `/cluster/resources`.

## References

- [PhoneBox inspiration](https://ersinkoc.github.io/phonebox/)
- [Proxmox API](https://pve.proxmox.com/pve-docs/api-viewer/)
- [Hestia REST API](https://hestiacp.com/docs/server-administration/rest-api) and [commands](https://hestiacp.com/docs/reference/cli)
- [Cloudflare Tunnel](https://developers.cloudflare.com/tunnel/)
- [Hostinger API](https://developers.hostinger.com/)
- [Jellyfin API](https://api.jellyfin.org/)
- [Open-Meteo](https://open-meteo.com/en/docs)
- [Stripe signatures](https://docs.stripe.com/webhooks/signature)

