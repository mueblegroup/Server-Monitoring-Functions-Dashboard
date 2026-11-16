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

Traffic rates are independent of SNMP `ifOperStatus`: PPP interfaces can report unknown or dormant even with valid byte counters. The status code remains visible in the API; rates still require two valid counter samples. UCD system-wide memory totals/free/buffers/cache are preferred over Host Resources pool accounting when available. Enable UCD in pfSense SNMP if the memory total does not match the installed RAM. Fallback accounting is explicitly noted.

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

### OpenAI Codex usage gauges

The **OpenAI Codex usage** widget shows primary/session and secondary/weekly percentage-used rings, remaining percentages, reset countdowns, and update time. Window durations and resets come from the actual account response; missing windows are unavailable rather than fabricated as 0%. These are Codex subscription limits, not a meter of every ChatGPT conversation or API billing. No guessed pacing, token totals, or credit balance is shown.

For a native Linux Orbit install, install and log in to the official CLI **as the same OS user running Orbit**:

```sh
npm install -g @openai/codex
codex login --device-auth
```

Complete the displayed OpenAI device login using the ChatGPT account whose limits you want to monitor. An API key is not a substitute for the ChatGPT subscription login. Add to Orbit `.env` and restart:

```dotenv
CODEX_USAGE_ENABLED=true
CODEX_BIN=codex
```

If the executable is outside the service PATH, use its absolute path in CODEX_BIN. Orbit reads `account/rateLimits/read` through `codex app-server` after initialization, without starting a model turn. The server caches successful readings for 60 seconds and only sends sanitized limit data to authenticated dashboard users. No account email, account ID, or auth tokens are sent to the browser. The Codex CLI is optional and is not installed in the base Docker image: Docker deployments must add the official CLI to their image and supply persistent CLI authentication for the `node` user before enabling this setting. Login credentials for the ChatGPT app on a different computer are not automatically available inside the Orbit container.

The first landscape screen uses a cockpit arrangement: large clock/local weather on the left, music on the right, and four small CPU, RAM, host/root-disk, and WAN tiles beneath. Hardware sensor badges remain in the host tile. Other widgets continue on subsequent screens. On smaller portrait displays, normal card packing preserves readability. Use Expand view to see all detail fields and the custom widget widths.

CPU, memory, and root-disk sparklines use the last hour of Proxmox RRD data when available. The optional RRD request can fail without losing current host metrics. WAN download history builds from real SNMP samples while the dashboard is open (up to 30 minutes); it has no backfilled history. Until enough samples exist, the tile says Collecting history. Curves have no synthetic live data. Music defaults to the custom Spotify player; the visible YouTube playlist embed remains available as a fallback.

### Music and fullscreen

#### Spotify custom player (default)

Spotify now uses a custom card with real album artwork, track/artist/album metadata, playback position, previous/play/pause/next, seeking, volume/mute and device transfer. Spotify Premium is required. The SDK connects only for a linked account and never starts playback automatically. Browsers must support encrypted media; autoplay restrictions can require pressing **Use this device** or Play. Leaving Overview disconnects this browser playback device; other Spotify clients remain available.

1. Create an app in [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Register **exactly** `https://orbit.mueble-playground.cc/api/spotify/callback` as its redirect URI (or your actual PUBLIC_ORIGIN followed by `/api/spotify/callback`). Enable Web API / Web Playback SDK where the app settings offer these choices.
2. For Development Mode, ensure the account is permitted under the app's Users Management settings. The app owner and playback account must meet Spotify's Premium/access requirements.
3. Put the app's **Client ID** in Orbit `.env`: `SPOTIFY_CLIENT_ID=YOUR_CLIENT_ID`. No client secret is needed; authorization uses PKCE. Restart Orbit.
4. Choose **Connect Spotify** on the music card, authorize your account on Spotify, and return to Orbit.
5. Choose **Use this device**, then **Choose music** and paste a Spotify album/playlist Share link. Alternatively select **Orbit Dashboard** in Spotify Connect and start music in the official client.

OAuth state is single-use, expires after ten minutes and is bound to the initiating Orbit account/session. Refresh tokens are stored per Orbit user in SQLite, encrypted with AES-256-GCM. Keep `data/spotify-token.key` with the database in backups; losing the key requires reconnecting Spotify. Only the short-lived access token required by the official browser SDK reaches that user's browser memory. Refresh tokens and client configuration secrets are never returned. Disconnect removes the local authorization; Spotify's account Apps page can revoke app access as well.

Use the **YouTube** button to switch back to the existing visible playlist embed. **Use Spotify** returns to the custom player. Playback permission errors are shown directly; unavailable tracks, Premium/account limitations and browser DRM restrictions are not silently bypassed.

For the YouTube fallback, choose **Connect playlist**, paste a YouTube Music/YouTube playlist Share link, and save. The playlist must be public or unlisted and allow embedding. Playback uses the YouTube privacy-enhanced embedded player with no autoplay; click Play. This connects a playlist, not the full YouTube Music account/library. No API key, password, cookies, or OAuth token is needed. Private playlists and restricted tracks may require opening the official YouTube Music app instead.

Use **Full screen** in the header for the browser Fullscreen API and screen-fit layout. Exit with the same button or Escape. Landscape orientation uses the extra width automatically; orientation is not forcibly locked. Browsers without Fullscreen API support can use their own fullscreen command or Add to Home Screen.

### Physical host temperature and fan sensors

Small temperature/fan badges appear in **Server health**. They show the highest reported temperature and fan speed (RPM or percentage, as reported); tap either for individual labeled readings. These values require physical hardware sensors, not a VM's virtual CPU. The included Python collector reads Linux `/sys/class/hwmon` without installing sensor drivers or accepting writes. Optional local IPMI support runs only the fixed read command described below. Missing fan tachometer/temperature support remains unavailable.

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

The authenticated workspace defaults to **Fit screen** mode: cards are packed into viewport-sized screens, with Previous/Next buttons, horizontal swipes and arrow keys. Packing uses the actual visual viewport, reserves shell/control space, and preserves the chosen widget order and widths. Cards never scroll internally. Dense cockpit mode needs at least 960px width and 470px usable content height; smaller displays use fewer cards per screen. If a compact summary still overflows, packing falls back to one row. Secondary fields move into **Details**, which opens the original live card in a separate dialog with its controls preserved. Long dialogs/forms may scroll, while the dashboard/cards do not. Resource lists, movies, storage pools and activity lists paginate. Use **Expand view** to restore the full scrolling layout. This update defaults older devices to the revised fit mode once, then remembers their subsequent choice. Login remains a normal scrolling page.

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


## Custom pages, movies and billing

Open **Pages** in the dashboard toolbar. **OpenAI usage** (#usage) has its own fit-screen page with subscription-limit gauges. **Billing** (#billing) shows Hostinger and recurring bills. Add a named custom page with any selection of supported tiles; use **Customize** on that page to resize and reorder them. Pages and fixed bills are saved per Orbit account. The Pages dialog also allows renaming and deleting custom pages.

The landscape overview splits the previous music area into Spotify/YouTube and a Jellyfin movie suggestion with background artwork, title and year. **Next suggestion** cycles the fetched library recommendations. Artwork passes through an authenticated Orbit endpoint; the Jellyfin API token stays on the server.

**Hostinger billing** joins VPS subscription IDs with GET /api/billing/v1/subscriptions. Renewal prices are converted from provider cents to currency units. Auto-renewing subscriptions use next_billing_at; others show expires_at. If subscription access fails, servers remain available and missing prices/dates are marked unavailable. The countdown ring estimates cycle progress from the subscription billing period; it is not a payment-status indicator. No billing operations are performed.

In **Recurring bills → Manage**, add/edit/delete a name, fixed amount, currency, monthly/yearly frequency and due date. Monthly dates such as the 31st clamp to the last day of short months and return to the 31st in later months. Yearly fees show amount/12 per month; monthly fees show amount*12 per year. Cycle allocation is prorated by actual calendar days between due dates, not metered consumption or a payment ledger. On the due date the ring reaches 100%; on the following day it advances to the next scheduled cycle. Different currencies are never summed.

### HP ProLiant DL380 G6 / iLO 2

This generation has temperature and fan monitoring through iLO 2. Linux hwmon may expose CPU temperatures; chassis sensors may require IPMI. On the physical Proxmox host, inspect availability first:

```sh
apt update
apt install ipmitool lm-sensors
sensors
ipmitool -I open sensor
```

To include those local IPMI readings in the existing collector, set SENSOR_IPMI=true in /etc/orbit-sensors.env and restart orbit-sensors. The collector runs ipmitool -I open sensor with an eight-second timeout, performs no fan-control commands, and preserves RPM versus percentage readings. A reading is only shown if the hardware supplies a valid value. Some firmware/sensors will not expose RPM. iLO 2 has no modern Redfish API.

The systemd collector runs as nobody, so IPMI will only work if that service account has read access to /dev/ipmi0. Check ls -l /dev/ipmi0 and test the command as the service account. Configure a dedicated device group and a persistent udev owner/group rule if necessary, then add that group using a systemd SupplementaryGroups override. Do not make the IPMI device world-writable or run the web collector as root. If device access or firmware support is absent, hwmon remains available. This must be installed on the physical host, not inside the Orbit container.

### YouTube Music account playback

Gmail sign-in and YouTube Premium work in the official YouTube Music app/site. The official YouTube APIs do not offer a full YouTube Music account playback SDK comparable to Spotify. Orbit can embed supported public/unlisted playlists with the visible YouTube player; Google OAuth alone does not turn that into your Premium Music library or guarantee ad-free/background playback. Use **Open YouTube Music** for the signed-in experience, or Spotify Premium for the integrated custom player. Orbit does not collect Google passwords or browser cookies.

## Smart stacks, visual layouts and operations

The toolbar now includes **Edit layout** and **Display**. All six new tiles can be selected through **Customize**, **Pages**, or the visual editor: Smart stack, Power & electricity, Service uptime, Backup status, Automation, and Billing overview. A compact health strip adds host/service warnings and upcoming fixed-bill/Hostinger reminders. Reminders appear inside Orbit; this release does not send email, SMS or push notifications.

### Visual layouts and appearance

**Edit layout** uses a 12-column by 6-row grid. Drag a tile to move it; drag its bottom-right corner to resize, or use the numeric controls/arrow keys. Add/remove any supported tile. Overlaps and out-of-bounds rectangles are rejected. The preview uses current tile readings without starting duplicate players or controls. Initial seeding includes only tiles that fit, so add the others deliberately. Save a portrait and landscape arrangement independently for each dashboard page. When a visual arrangement exists, **Customize** opens the visual editor. **Use automatic layout** removes both orientation overrides for that page and returns to responsive pagination. Very small tiles still use compact summaries and Details; adding more content than a physical screen can display does not make it readable.

**Display** configures appearance globally or for the current page: original/rounded/flat/glass preset, accent, font, spacing, card corners and opacity. Controls preview appearance before saving; dismissing the dialog restores saved appearance. A page override takes precedence over global appearance; **Use global appearance for this page** removes that override. Settings/layouts persist per account in SQLite. Demo edits are temporary and remain within that browser visit.

Smart stack supports CPU, memory, hottest temperature, fan speed, power and WAN download. Select the contents and interval in Display. Use previous/next, swipe horizontally, or pause/resume on the tile. Auto-rotation stops while the tile is offscreen, the tab is hidden, or a dialog is open.

### Power and energy

Update deploy/host-sensors.py on the physical host and restart orbit-sensors. The collector now includes hwmon power input/average values (microwatts converted to watts), IPMI Watts readings, and temperature warning thresholds when supplied. Orbit prefers the IPMI **Power Meter** total over other non-PSU meter readings. It never adds ACPI, PSU and IPMI copies together. A PSU-only reading is not assumed to be whole-server power. Percentage fan readings remain percentages.

The Orbit server samples the configured collector every approximately 30 seconds and retains readings for 30 days, even when no dashboard is open. The tile shows fresh power, the last 24 hours of history, observed kWh, and covered sample hours. Energy is trapezoidally integrated between valid samples; gaps over three minutes are excluded. No history is fabricated/backfilled. Set currency and your per-kWh rate in Display. Observed energy cost uses the current flat rate; at-this-load daily/30-day costs are projections, not a utility bill. Taxes, tiers, standing charges and previous tariff changes are not modeled. Updating the collector remains a host installation step; pulling the Orbit repository does not update the file already installed under /opt/orbit-sensors.

### Service monitoring

Orbit monitors itself on loopback by default. To replace that list, put JSON in the server's .env, with single quotes around it:

```dotenv
ORBIT_MONITORS='[{"id":"orbit","name":"Orbit","url":"http://127.0.0.1:3000/","intervalSeconds":60,"expectedStatus":200},{"id":"n8n","name":"n8n","url":"https://n8n.mueble-playground.cc/","intervalSeconds":60,"expectedStatus":200}]'
```

Add Jellyfin, Postiz and websites using their real reachable URLs. Optional `token` sends a Bearer header. URLs/credentials stay server-side and are never accepted from browser requests. HTTP/HTTPS only; redirects are not followed. HTTPS certificate verification remains enabled for uptime checks. The scheduler wakes every 30 seconds, checks due services in batches of five, and uses an eight-second timeout. Checks and power sampling stop when Orbit is stopped. Restart after changing environment configuration. Use ORBIT_MONITORS=[] to disable service checks.

Uptime shows current check status and response time. **History** shows response graphs, passing-check percentage and observed outage/recovery timestamps. It is sampled availability, not proof of uninterrupted uptime or a service's internal functionality. Missing/stale checks are marked unknown/stale. Data is retained for 30 days; the UI returns up to 1,440 recent checks per target. HTTP 200 on a login page only proves that URL responded; use a dedicated health endpoint where available.

### Backups and alerts

Backup status reads `/cluster/backup`, `/nodes`, and each online node's `/nodes/{node}/tasks?typefilter=vzdump&limit=50`. It displays the latest successful returned task, failed/warning tasks, configured jobs and the provider's next-run timestamp. Partial failures preserve available schedules/history. `Sys.Audit` is needed for cluster backup configuration and other users' task history. No backup is started or modified. This is task history, not verification of backup contents or complete guest coverage; older tasks outside the returned history are unavailable.

Display lets you set fallback temperature, storage usage and bill reminder thresholds. Hardware-provided temperature warnings take precedence, so a zone with a 110°C warning threshold is not judged by the generic CPU threshold. The strip also reports offline nodes, missing metrics and stale/offline service checks. Select the alert count to read all current alerts.

### Kiosk

Enable kiosk in Display, select pages and interval, configure night hours/brightness, and optionally keep the screen awake. Rotation advances internal widget screens before moving to the next selected page. Interaction pauses rotation for 60 seconds; the header offers manual Pause/Resume. Open dialogs, hidden tabs and foreground loading pause rotation. Portrait/landscape layouts follow device orientation. Night hours use the viewing device's local clock; equal start/end disables dimming. Wake lock is best-effort and depends on browser support/power settings. Enter fullscreen using the existing header button; browsers require a user gesture. The dim overlay does not alter the device's physical brightness setting.

### n8n / webhook actions and results

Configure only named actions you want available in Orbit. Each trigger requires an Orbit session, CSRF, exact-origin validation and explicit confirmation. In-flight duplicate requests are rejected; HTTP failures/timeouts are never retried automatically. Request URLs and credentials cannot be supplied by the browser.

```dotenv
ORBIT_AUTOMATIONS='[{"id":"daily-report","name":"Generate daily report","url":"https://YOUR_N8N_HOST/webhook/orbit-daily-report","token":"OUTBOUND_WEBHOOK_BEARER_SECRET","callbackToken":"SEPARATE_LONG_RANDOM_RESULT_SECRET"}]'
```

Restart Orbit. Configure the n8n Webhook node to accept POST and require the outbound Bearer secret. Orbit sends `{source:"orbit",action:"daily-report",requestedAt:"..."}`. HTTP acceptance leaves the tile waiting for workflow completion; a successful request is not treated as a completed workflow.

At the end of the workflow, use an HTTP Request node to POST to:

```
https://YOUR_ORBIT_HOST/api/automation-events/daily-report
```

Headers: `Authorization: Bearer SEPARATE_LONG_RANDOM_RESULT_SECRET`, `Content-Type: application/json`. Body:

```json
{"status":"success","summary":"Daily report generated"}
```

Supported statuses are running/success/failed; summary is plain text up to 500 characters. Callbacks authenticate with the separate callback token and do not require browser cookies, Origin or CSRF. Use HTTPS and unique random secrets; keep the .env outside git. Automation actions are audited. History/result data persists in SQLite; a timed-out trigger may already have executed, so check n8n before sending another request.

Billing overview combines fixed bills and available Hostinger renewal prices into monthly/yearly equivalents **per currency**, with upcoming due dates. Do not add the same Hostinger cost manually unless you intend it to be counted twice. There is no currency conversion or payment verification.
