# Changes

## Public source preparation — 2026-10-02

- Recovered the actual deployed client and Node backend without user data.
- Organized client, server, deployment examples, documentation, and third-party notices.
- Removed embedded admin credentials and client-side shared-PIN access; bootstrap now uses private environment configuration.
- Added random session tokens, corrected first-run save initialization, and made unreadable databases fail closed.
- Made the data path configurable and removed unused package dependencies.
- Added the previously missing manifest and a minimal network-only service worker.

The server remains a prototype with the limitations in SECURITY.md. Public-copy changes were not applied to the original deployment.
