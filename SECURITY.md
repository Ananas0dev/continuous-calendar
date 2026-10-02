# Current security limits

This is a household prototype published for review. The public export removes hardcoded admin credentials, removes the shared-secret administrator bypass, requires an explicit bootstrap password, and uses cryptographically random session tokens. The original live deployment was not modified.

Remaining concerns in the recovered design include plaintext passwords in the private JSON database, browser-stored tokens and pending-login data, permissive CORS, no general rate limiting, no fixed maximum JSON request body, non-atomic persistence, and unreviewed note/role authorization paths. It has not had a comprehensive security audit.

Use trusted LAN access with HTTPS and restrictive filesystem permissions. Keep the database, backups, environment files, and browser exports private. Public source availability is not a claim of suitability for Internet-facing multi-tenant hosting.
