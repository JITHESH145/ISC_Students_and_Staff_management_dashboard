# `api/` — serverless functions (Vercel)

## `staff-admin.js` — privileged staff-account admin (Admin SDK)

Solves the "email already has a login account" error on re-adding a
deleted staff member. Firebase keeps a person's **login** (Auth account)
and their **app data** (Firestore docs) in two separate stores; the
browser can create an Auth account but cannot look up or delete anyone
else's by email. So removing a staff member leaves the Auth account
orphaned, and re-adding the same email fails.

This function uses the Firebase **Admin SDK** (a service account) to:
- `action: 'resolve'` — return the existing Auth uid for an email, so a
  re-add adopts it and rebuilds the Firestore docs (heals any orphan,
  however it was deleted — app or Firebase console).
- `action: 'delete'` — actually delete the Auth account on permanent
  delete, so no orphan is ever created again.

Both are CEO-only (the caller's ID token is verified and their
`roles/{uid}` must be an active CEO). Admin Auth operations are **free on
the Spark plan** — no Blaze upgrade needed.

### Setup (required to fully activate the permanent fix)
1. Firebase console → **Project settings → Service accounts →
   Generate new private key**. A JSON file downloads. **Keep it secret —
   never commit it.**
2. Vercel → Project → **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `FIREBASE_SERVICE_ACCOUNT` | the entire service-account JSON (paste as-is, or base64-encode it) |

3. Redeploy. Until this is set the function returns `{ status: 'disabled' }`
   and the app falls back to its tombstone path (re-adds still work when the
   deletion went through the app's Delete button; console deletions need the
   sign-in-once recovery).

---



## `send-email.js` — notification email sender

Sends notification emails on Vercel's **free** Hobby tier. No Firebase
Blaze plan and no paid email service required — it uses your own Google
account's SMTP via a free App Password.

### How it fits in
The client's `notifyStaff()` helper ([src/firebase/services.js](../src/firebase/services.js))
writes the in-app notification **and** POSTs to `/api/send-email` with the
signed-in user's Firebase ID token. This function verifies that token
(against Google's public certs — no service account needed) and sends the
email. The mail password lives only in Vercel env — never in the browser
bundle (that was the security problem that got the old EmailJS path removed).

### Feature flag
Until the `MAIL_*` env vars are set, the function returns
`{ status: 'disabled' }` and sends nothing. In-app notifications keep
working. Email switches on the moment the env vars exist.

### Setup (when you're ready to enable email)
1. Pick a sending account — ideally a Google **Workspace** address on
   `@internationalskillsclub.com` (best deliverability), or any Gmail.
2. Turn on **2-Step Verification** for that Google account, then create an
   **App Password** (Google Account → Security → App passwords).
3. In Vercel → Project → **Settings → Environment Variables**, add:

   | Variable | Value |
   |---|---|
   | `MAIL_USER` | the sending address, e.g. `no-reply@internationalskillsclub.com` |
   | `MAIL_APP_PASSWORD` | the 16-char Google App Password |
   | `MAIL_FROM` | *(optional)* `ISC SMS <no-reply@internationalskillsclub.com>` |
   | `FIREBASE_PROJECT_ID` | *(optional)* defaults to `isc-sms-test` |

4. Redeploy (`vercel --prod`). Done — emails now send.

### Local development
`vite` does not run `api/` functions, so email is a silent no-op on
`localhost:5173` (in-app notifications still work). To exercise the email
path locally, run `vercel dev` instead, or just test it on a deploy.

### Limits & notes
- Gmail sending limits: ~500/day (personal) or ~2,000/day (Workspace) — fine
  for an internal tool.
- Only authenticated staff can trigger a send (ID-token checked). This
  matches the existing trust model (any active staff can already create a
  `notifications` doc per `firestore.rules`).
