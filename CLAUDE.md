# CLAUDE.md — ISC SMS

> Context file for Claude sessions. Read this first. Keep it current (see **Maintenance Note** at the bottom).

## 1. Project Overview
Internal **Student Management System** for **International Skills Club (ISC)** — a training institute. Staff and the CEO manage students, batches, schedules, attendance, assessments, follow-ups, concerns, tasks, and a lead pipeline. It's a role-based single-page PWA (works on phone/tablet/desktop); there is no public-facing side.

## 2. Tech Stack
- **Frontend:** React **19** (`react@^19.2`), **Vite 8**, `react-router-dom@6.30` (SPA, `BrowserRouter`)
- **Language:** JavaScript + JSX only — **no TypeScript** (`@types/*` are present but files are `.js`/`.jsx`)
- **Backend (BaaS):** **Firebase 12** — Firestore (data), Auth (email/password login), Storage (documents), Cloud Messaging/FCM (push)
- **UI:** inline styles + CSS design tokens in `src/index.css`; icons via `lucide-react`; charts via `recharts`; dates via `date-fns`; fonts Bricolage Grotesque + Hanken Grotesk (Google Fonts)
- **Email:** EmailJS was **removed** — client-side email is disabled (see Gotchas)
- **Tooling:** ESLint 10 (flat config), `firebase-tools` (emulators/deploy), `@firebase/rules-unit-testing`
- **Hosting:** Vercel (live: `isc-students-and-staff-management-d-mu.vercel.app`; `vercel.json` holds the SPA fallback rewrite + security headers) and/or Firebase Hosting (`dist/`)

> Note: `README.md` / `TECHNICAL_DOCUMENT.md` say "React 18" — `package.json` is the source of truth (React 19).

## 3. Project Structure
```
isc-sms/
  src/
    main.jsx              App entry
    App.jsx               Routes + role-based nav (NAV_BY_ROLE), route guards, AppShell
    index.css             Design system: CSS tokens (teal --accent #0F9E8E), global styles
    firebase/
      config.js           Firebase init (config hardcoded); exports auth, db, storage, messaging
      services.js         ALL Firestore reads/writes live here (single data-access layer)
      adminAuth.js        Create staff Auth accounts via isolated secondary app (CEO stays logged in)
      emailService.js     Email stubs — DISABLED client-side (exports kept for callers)
      fcm.js              Push token registration + foreground message handler
    context/
      AuthContext.jsx     user + profile (role) + login/logout/resetPassword
      NotifContext.jsx    Real-time in-app notifications + FCM foreground toast
    components/
      layout/Sidebar.jsx, layout/Topbar.jsx
      ui/index.jsx        Shared UI (Modal, Toast, Avatar, Loading, etc.)
      ui/NotifBell.jsx
      ErrorBoundary.jsx   Wraps main content
    pages/                One file per route (see Routes below)
  firestore.rules         Hardened Firestore security rules
  storage.rules           Hardened Storage rules (10MB cap, content-type allowlist)
  firebase.json           Rules paths, hosting, emulator ports
  scripts/backfill-phase1.mjs   One-time data migration (roles, staffDirectory, staffIds)
  tests/rules.test.mjs    Firestore rules emulator tests
  design_handoff/         Static HTML/PNG design mockups (reference only, not shipped)
  security.patch          Stray archived patch file — do not touch (see What NOT to do)
```
**Routes** (`App.jsx`): `/` (role home), `/students`, `/students/:id`, `/followups`, `/concerns`, `/assessments`, `/batches`, `/schedule`, `/leaderboard`, `/tasks`, `/reports`, `/leads`, `/documents`, `/staff`, `/requests`, `/trash`, `/login`.

## 4. Key Conventions
- **Data access:** never call Firestore directly from a component — add/use a function in `src/firebase/services.js`.
- **Query scoping:** staff-facing reads must include the `where()` clause the rules require (e.g. `staffIds array-contains uid`, `assignedToEmail == email`). Firestore rules **reject** unprovable queries, they do not filter — passing a `scope` object `{ role, uid, email }` and branching on `isCeoScope(scope)` is the established pattern.
- **Sorting/filtering:** done **in JS after fetch**, not with Firestore `orderBy`, to avoid composite-index requirements. Keep it that way.
- **Timestamps:** `serverTimestamp()` for `createdAt/updatedAt`; ISO strings (`new Date().toISOString()`) inside nested map fields.
- **Styling:** inline `style={{}}` + CSS variables (`var(--accent)`, `var(--ink)`, etc.) from `index.css`. No CSS-in-JS lib, no Tailwind.
- **Naming:** components `PascalCase.jsx`, one page per route; services are named exports; role checks compare against `'ceo'` / `'staff'`.
- **Errors:** service reads often `try/catch` returning `[]`/`null` on failure; UI wrapped in `ErrorBoundary`; `console.*` gated behind `import.meta.env.DEV`.
- **Lint:** `eslint.config.js` (flat) with `js.recommended` + react-hooks + react-refresh. No Prettier config — match surrounding style.

## 5. Core Features (how each works end-to-end)
- **Auth & roles:** Firebase email/password login (`AuthContext`). On auth change, loads `staff/{uid}` into `profile` (drives UI/nav). **Authorization is enforced separately** by `roles/{uid}` in the rules. **Domain restriction:** only `@internationalskillsclub.com` emails may sign in — enforced in the login form, in `AuthContext` (`isAllowedEmail`; non-domain sessions are signed out on auth change), and in `createStaffAccount`.
- **Role-based nav:** `NAV_BY_ROLE` in `App.jsx` → `ceo` sees everything; `staff` sees a scoped subset. Home route renders `Dashboard` (ceo) or `StaffDashboard` (staff).
- **Batches** (the hub): CEO creates batches; tabs for Students, Onboarding Analytics, Assignments, Assessments, Staff. Only **Active** batches are editable (status gates add/edit of students/tasks/assessments).
- **Students:** paginated/searchable; created into a batch with denormalized `staffIds[]` (= batch staff + mentor) so scoping works. Batch moves recompute `staffIds` (CEO-only).
- **Schedule:** shared global calendar (Day/Week/Month) across all batches; classes, meetings, and assessments appear. Staff mark attendance + write per-student class progress reports.
- **Assessments:** create for all/specific students, enter marks (CSV or manual) → `assessments` + `assessmentResults`; joined per-student for the profile Performance view.
- **Tasks:** CEO assigns staff to-dos; staff complete their own with a required note. Staff may only update `status/completionNote/completedBy/completedAt`.
- **Follow-ups / Concerns / Reports / Leads:** assignee/author-scoped records; Leads are **CEO-only**.
- **Staff Management:** `createStaffAccount` (adminAuth.js) makes the Auth user via an isolated secondary app so the CEO isn't logged out, writes `staff/`, `roles/`, and `staffDirectory/` docs, and emails a password-reset link. **Delete → re-add (Auth vs Firestore split):** a person = a Firebase **Auth** account (login) + **Firestore** docs (`staff`/`roles`/`staffDirectory`). The client can't delete/look-up another user's Auth account by email, so removing a staff member used to orphan the Auth account → `email-already-in-use` on re-add. Fixed by `api/staff-admin.js` (Admin SDK, service account, CEO-only): permanent delete calls `action:'delete'` to remove the Auth account too (no orphan ever); re-add on `email-already-in-use` calls `action:'resolve'` to recover the uid and rebuild the docs (heals any orphan, incl. ones deleted directly in the Firebase console). Requires `FIREBASE_SERVICE_ACCOUNT` env var in Vercel; when unset the function is `disabled` and the app falls back to the client `deletedStaff/{uid}` tombstone + sign-in-once self-registration. **Resend setup email:** `resendStaffSetupEmail` (Staff Management success modal + per-row button) re-sends the password-setup link with a 30s cooldown.
- **Notifications:** in-app via Firestore `notifications` (real-time `onSnapshot` in `NotifContext`) + optional FCM web push (needs VAPID key).
- **Trash & Requests:** soft-delete/restore of students & batches (CEO-only); staff removal/other requests reviewed by CEO.

## 6. Environment Variables
Firebase client config is **hardcoded** in `src/firebase/config.js` (public Firebase keys — safe to expose). The only env var:
- `VITE_FIREBASE_VAPID_KEY` — Web Push (FCM) public key. **Optional**; app runs without it (push just won't register). See `.env.example`. Put it in a git-ignored `.env`.

Backfill script only: `GOOGLE_APPLICATION_CREDENTIALS` — path to a Firebase service-account JSON (**must stay outside the repo**, never committed).

## 7. Database Schema (Firestore collections)
- **`roles/{uid}`** `{ role: 'ceo'|'staff', active }` — **authorization source of truth** (CEO-writable only).
- **`staff/{uid}`** full profile `{ name, email, role, subjects[], active, fcmToken }` — readable by owner + CEO. `role` here is display-only.
- **`staffDirectory/{uid}`** safe public subset `{ name, role, subjects, active, email }` (no `fcmToken`) — used by pickers/dropdowns.
- **`students/{id}`** `{ name, phone, email, batchId, staffAssigned, status, staffIds[], courseFlow, ... }` — `staffIds[]` = denormalized batch staff+mentor for scoping.
- **`batches/{id}`** `{ course, startDate/endDate, status, staffIds[], mentorId, courseFlow, studentFields }`.
- **`schedules/{id}`** calendar entries `{ batchId, day/scheduledDate, time, type, participantStudents, status }`.
- **`attendance/{id}`** per session `{ scheduleId, batchId, records: {studentId→{name,present}} }` (upserted, one doc/session).
- **`classReports/{id}`** per-student class notes `{ studentId, scheduleId, batchId, facultyUid, note, rating }`.
- **`assessments/{id}`** `{ batchId, title, date, totalMarks, conductingStaff, participantType, participantStudents, status }`.
- **`assessmentResults/{id}`** `{ assessmentId, studentId, marks, percentage, pass }`.
- **`batchTasks/{id}`** in-batch assignments `{ batchId, title, assignedFaculty, assignedType, assignedStudentIds, submittedBy[] }`.
- **`tasks/{id}`** staff to-dos `{ assignedToEmail, status, completionNote }`.
- **`followups/{id}`**, **`concerns/{id}`**, **`reports/{id}`** (daily), **`leads/{id}`** (CEO-only), **`notifications/{id}`** (`toEmail`-scoped), **`requests/{id}`**, **`trash/{id}`** (CEO-only, `type: student|batch`), **`deletedStaff/{uid}`** (CEO-only tombstones `{ uid, email, name, role, deletedAt }` for orphaned Auth accounts).

**Relationships:** `student.batchId → batch`; `student.staffIds[]`/`batch.staffIds[]`/`batch.mentorId → roles`/`staff uid`; `assessmentResults.assessmentId → assessment`; `attendance`/`classReports.scheduleId → schedule`; `batchTasks`/`assessments`/`schedules.batchId → batch`.

## 8. Common Commands
Run from the `isc-sms/` directory. **Note:** this machine's `C:` drive is full — npm cache is redirected to `D:` (`npm config get cache` → `D:\npm-cache`); keep it there.
```bash
npm install          # install deps
npm run dev          # Vite dev server → http://localhost:5173
npm run build        # production build → dist/
npm run preview      # preview the built app
npm run lint         # ESLint
npm run test:rules   # Firestore rules tests (needs Firebase emulator + Java)
# Deploy rules (manual, deliberate): firebase deploy --only firestore:rules,storage
```

## 9. Known Gotchas / Decisions
- **Two role sources:** `profile.role` (from `staff/{uid}`) drives UI only; real authorization is `roles/{uid}` enforced by rules. Changing a role means updating **both** `roles/` and `staffDirectory/` (see `setRoleDoc` / `setDirectoryDoc`), not just the staff doc.
- **`staffIds[]` must stay in sync:** it's denormalized onto every student. When batch staff/mentor changes, call `syncBatchStaffToStudents`; on batch move, recompute via `getBatchStaffIds`. Never let a component set `staffIds` directly (`updateStudent` strips it).
- **Queries must prove the rule:** add the required `where()` clause for staff scope or the read is rejected outright. This is why many service functions take a `scope` arg.
- **No `orderBy` in Firestore queries** — sort in JS (avoids composite indexes). Deliberate.
- **Email is disabled client-side** — `emailService.js` functions are no-op stubs (`{status:'disabled-client-side'}`). Real email goes server-side via `notifyStaff` → `/api/send-email` (Vercel function, `api/send-email.js`); it builds a branded HTML email from structured `details` (`[{label, value}]` — assigned by, due date, meet link, …) passed by the call sites. Mail creds live only in Vercel env vars. Never re-embed provider keys in the client.
- **Staff creation uses a secondary Firebase app** (`adminAuth.js`) so creating a user doesn't sign the CEO out. Don't call `createUserWithEmailAndPassword` on the primary `auth`.
- **Rules bootstrap:** the hardened rules read `roles/{uid}`; before deploying them the CEO's `roles` doc must exist or everyone (incl. CEO) is locked out. See `SECURITY_SETUP.md`. The **live** project may still run broad "any authenticated user" rules — deploy the repo rules deliberately.
- **Documents page** needs Firebase Storage enabled with the shipped `storage.rules`; if it won't load, check Storage setup.
- **Passwords** are generated with a CSPRNG (`crypto.getRandomValues`) — never introduce `Math.random()` for anything security-related.

## 10. What NOT to do
- Don't bypass `src/firebase/services.js` with ad-hoc Firestore calls in components.
- Don't add Firestore `orderBy`/composite-index-requiring queries; sort in JS.
- Don't grant authority via the `staff` doc — authority lives in `roles/{uid}` only.
- Don't re-add client-side EmailJS / embed any secret in the bundle (public Firebase config is the only exception).
- Don't hand-edit `security.patch` (archived diff), `scripts/backfill-phase1.mjs` (one-time migration), or `design_handoff/` (static mockups) as if they were live app code.
- Don't run `firebase deploy` of rules casually — it's a manual, reviewed step (can lock users out if `roles` isn't bootstrapped).
- Don't commit `.env` or any service-account JSON.
- Don't "fix" the React version to 18 based on the older docs — package.json (React 19) is correct.

---
### Maintenance Note
**Keep this file current.** Re-run the analysis / update this file whenever a major change lands — a new module or route, a new collection or schema change, a new integration (e.g. server-side email, payments), an auth/roles change, or a dependency major-version bump. If code and this file disagree, trust the code and fix this file. A stale CLAUDE.md gives future sessions wrong context, which is worse than none.
