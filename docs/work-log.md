# Work log and planned tasks

This is the dated engineering record for the public Continuous Calendar source. It records completed work from Git history and separates it from planned work. Dates use Asia/Riyadh time. It contains no household calendar entries, credentials, or production data.

## Completed work

| Date | Change | Code and documentation affected | Evidence |
| --- | --- | --- | --- |
| 2026-10-22 | Added a shareable one-file local calendar with per-browser storage, no account flow, and JSON backup import/export. Fixed English labels across the toolbar and week, day, year, decade, Needs, and Cosmic views. | `client/continuous-calendar-local.html`, its build script, `client/index.html`, README, gallery captures, and this log. The backup can merge notes, recurring events, and Needs into a signed-in hosted calendar. | Manually previewed all six English views in Edge with remote requests blocked; no Arabic text remained visible. Refreshed the 430 px mobile Needs capture; it had no horizontal overflow. No automated test suite was run. |
| 2026-10-21 | Refreshed the visual gallery with a GIF and current English, Arabic, desktop, and mobile captures. | Screenshots, README, and this work log. Captures use synthetic notes and Needs items in an isolated local instance. | English desktop and mobile Edge captures reported no page errors; mobile content stayed within its 430 px viewport. See the [gallery](../screenshots/README.md). |
| 2026-10-02 | Prepared a public-source release from the recovered deployment. | `client/index.html`, `server/server.js`, deployment examples, `docs/`, `SECURITY.md`, licenses and notices. Embedded credentials and the shared-PIN path were removed; startup uses an environment-provided password. | Commit `bc8b8aa`; [changes](../CHANGELOG.md). |
| 2026-10-03 | Added a reproducible screenshot gallery using an isolated database and synthetic notes. | `screenshots/` and `README.md`. | Commits `93ce729` and `1fadf9f`; [gallery](../screenshots/README.md). |
| 2026-10-06 | Added shared household needs: categories, items, deadlines, completion state, and calendar links. | `client/index.html` renders and edits needs; `server/needs.js` validates, versions, and persists them; `server/server.js` exposes the API; `docs/architecture.md` and `docs/data-format.md` describe storage. | Commit `03b2140`; [changes](../CHANGELOG.md). |
| 2026-10-06 | Improved language consistency and calendar navigation. | `client/index.html` adds a Go to Today path, preserves the selected date when changing view scale, and applies the chosen font scale to more controls. `server/needs.js` permits approved users to add categories while reserving category editing/removal for admins. | Commit `ecbffa2`; [changes](../CHANGELOG.md). |
| 2026-10-18 | Added this work log and a GitHub issue form so future work has a date, scope, acceptance criteria, and evidence. Established the current server-test baseline. | `docs/work-log.md`, `.github/ISSUE_TEMPLATE/task.yml`, and the repository entry points. | `npm --prefix continuous-calendar/server test` passed: 1 test covering first-run configuration, authorization, served assets, and corrupt-database handling. |

## Current task queue

These are planned items, not claims that the work is finished.

| ID | Task | Why it matters | Expected scope | Done when |
| --- | --- | --- | --- | --- |
| CC-01 | Extend server tests for needs and permissions. | The existing test covers startup, auth boundaries, served assets, and corrupt-database handling, but not the needs workflow. | `server/test/server.test.js`, `server/needs.js`, and only the necessary server code. | Tests cover approved/admin permissions, item ownership, category changes, deadlines, and stale-version conflicts. |
| CC-02 | Write an authentication and persistence improvement design. | Passwords are still stored in plaintext and persistence recovery needs stronger assurance. | `SECURITY.md`, `docs/architecture.md`, a design note, and later implementation issues. | A reviewed migration/rollback plan and tests are defined before data-format changes. |
| CC-03 | Map the single-file client before refactoring. | The recovered client is intentionally one large file; splitting it safely needs clear boundaries. | A module map for calendar views, notes, auth, needs, storage, and external integrations. | The map identifies interfaces and a small first extraction with behavior-preservation checks. |
| CC-04 | Run bilingual and mobile manual checks. | The calendar has Arabic/English modes and many responsive controls. | A concise checklist and synthetic screenshots where helpful. | Both languages, day/week/year views, needs, sign-in, and small-screen navigation have recorded results. |

### Authentication prototype review

An unmerged prototype automatically tries registration after an unknown-username login response and caches failed Hijri requests as empty results for the rest of the session. Its comment says it adds exponential backoff, but the code does not. Keep it out of the public source until sign-up is explicit and the retry behavior is bounded and accurate.

## Suggested two-week work plan

The plan begins Sunday, 2026-10-18. It is a public engineering plan, not a personal appointment calendar. Move dates when real life or higher-priority work changes them.

| Target date | Focus | Deliverable |
| --- | --- | --- |
| Oct 18 | Record history and organize work. | This log, task issue form, and the homelab plan. |
| Oct 19 | Define needs API test cases. | A compact matrix for permissions, category changes, deadlines, and stale updates. |
| Oct 20 | Test the needs permissions. | A small, focused test change or an issue containing the exact missing cases. |
| Oct 21 | Review authentication and data persistence. | A scoped design issue with migration, rollback, and privacy considerations. |
| Oct 22 | Check the calendar interface. | Bilingual/mobile manual-check list with real findings only. |
| Oct 25 | Map client responsibilities. | A short function/feature map for the recovered `client/index.html`. |
| Oct 26 | Choose one small refactor or test task. | A single issue with scope and completion criteria. |
| Oct 27–29 | Implement, test, and document the selected small task. | One coherent code change, test evidence, and changelog/work-log entry. |

## How to keep this timely

1. Open a GitHub task using the **Task / work record** form before starting a change. Describe the user-visible goal, affected files, date, and completion check.
2. Keep a task small enough for one reviewable commit when practical. Use an accurate present-tense commit title, such as `Test needs category permissions`.
3. On the day work ends, add a completed-work row with the commit, affected areas, and the command or manual check that actually ran. Do not mark an item complete based on a plan alone.
4. Keep secrets, household data, internal hostnames, screenshots of real notes, and raw server logs out of issues, commits, and this log.
5. At the end of each week, move unfinished items forward with a short reason rather than rewriting history.

The broader cross-project schedule is in the [homelab work plan](https://github.com/Ananas0dev/homelab/blob/main/WORK_PLAN.md). Technical risk and deployment limits remain in [SECURITY.md](../SECURITY.md) and the [roadmap](roadmap.md).
