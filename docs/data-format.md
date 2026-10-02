# Data and persistence

The server stores `settings`, `users`, `notes`, `recurringEvents`, `indicators`, and `lastUpdated` in one private JSON database. Notes are grouped by a date-derived parent ID; existing client code uses zero-based JavaScript month values in these IDs.

Users carry profile information, approval state, role, session tokens, and passwords. The recovered implementation stores passwords in plaintext; the database is sensitive and must never be published. The public repository includes no copied database, user account, session, or calendar entry.

Writes are debounced by 50 ms in the recovered implementation. They are not atomic transactions, and there is no multi-process locking. Run one server process, back up privately, and treat abrupt shutdown or storage failure as a recovery concern. Startup now fails on unreadable JSON instead of replacing it with fresh state.

Unpinned notes older than 30 days may be cleaned by the server's expiry logic. Pinned notes are retained. Review that behavior before importing important long-term records.
