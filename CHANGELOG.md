# Changes

## Shared household needs and login reliability — 2026-10-06

- Added server-backed shared needs categories and items, with admin-only category management, item deadlines, completion tracking, and calendar links.
- Made username lookup tolerate malformed account rows and persist login sessions atomically before returning them.
- Removed a private-network address fallback from the public client; API requests use the current origin.
- Documented needs data and API behavior.

## Public source preparation — 2026-10-02

- Recovered the actual deployed client and Node backend without user data.
- Organized client, server, deployment examples, documentation, and third-party notices.
- Removed embedded admin credentials and client-side shared-PIN access; bootstrap now uses private environment configuration.
- Added random session tokens, corrected first-run save initialization, and made unreadable databases fail closed.
- Made the data path configurable and removed unused package dependencies.
- Added the previously missing manifest and a minimal network-only service worker.

The server remains a prototype with the limitations in SECURITY.md. Public-copy changes were not applied to the original deployment.
