# Data and persistence

The server stores `settings`, `users`, `notes`, `recurringEvents`, `indicators`, `needsCategories`, `needsItems`, `needsRevision`, and `lastUpdated` in one private JSON database. Notes are grouped by a date-derived parent ID; existing client code uses zero-based JavaScript month values in these IDs.

Users carry profile information, approval state, role, session tokens, and passwords. The recovered implementation stores passwords in plaintext; the database is sensitive and must never be published. The public repository includes no copied database, user account, session, or calendar entry.

Writes replace the database atomically through a temporary file, but there is no multi-process locking or transaction journal. Run one server process and keep private backups. Startup fails on unreadable JSON instead of replacing it with fresh state.

Unpinned notes older than 30 days may be cleaned by the server's expiry logic. Pinned notes are retained. Review that behavior before importing important long-term records.


Household needs categories and items are shared with calendar visitors. Approved signed-in users can add categories and manage their own items; admins can rename/remove categories and moderate items. Deadlines are plain Gregorian `YYYY-MM-DD` values and render in each viewer’s local calendar. Items carry creation/completion timestamps and a revision used to reject stale edits. The built-in `groceries` category displays as “Groceries” in English, including for databases created with the earlier “Supermarket” label.
