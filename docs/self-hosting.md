# Self-hosting on a trusted LAN

Run the local quick start first. For Linux deployment, create a dedicated `calendar` user, place the repository at `/opt/continuous-calendar`, and create `/var/lib/continuous-calendar` owned by that user with mode 0700.

Create `/etc/continuous-calendar.env` privately, mode 0600, with `CALENDAR_ADMIN_PASSWORD` and `CALENDAR_DATA_FILE=/var/lib/continuous-calendar/db.json`. Use a unique first-run password of at least 12 characters. The server reads process variables; it does not automatically parse `.env` files.

Review and install [the systemd unit](../systemd/continuous-calendar.service). Its writable directory is the data directory. The server binds loopback, so place nginx in front of it using [the example](../nginx/continuous-calendar.conf.example). Replace the example hostname and certificate paths. Keep `/api/` at the domain root even when the UI is under `/calendar/`.

Certificates and DNS API credentials belong outside the repository. Test `nginx -t` and `systemd-analyze verify` against the actual host before enabling the files. The provided configuration is a template, not a copy of a private hostname or certificate.

Read [SECURITY.md](../SECURITY.md). Do not expose this recovered application's current authentication/data model directly to the public Internet.
