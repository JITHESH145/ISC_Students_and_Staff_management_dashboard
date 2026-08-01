// ─────────────────────────────────────────────────────────────────
// Vercel serverless function — email notification sender.
//
// Runs on Vercel's FREE Hobby tier (no Firebase Blaze needed). The
// mail credentials live ONLY in Vercel environment variables and are
// never shipped to the browser. Callers must present a valid Firebase
// ID token (verified here against Google's public certs — no service
// account required), so only signed-in ISC staff can trigger a send.
//
// FEATURE FLAG: if MAIL_USER / MAIL_APP_PASSWORD are not set, this
// returns { status: 'disabled' } and sends nothing. Email "turns on"
// the moment those env vars are configured in Vercel.
//
// Required Vercel env vars (Project → Settings → Environment Variables):
//   MAIL_USER          the sending Gmail/Workspace address
//   MAIL_APP_PASSWORD  a Google App Password (needs 2FA on the account)
//   MAIL_FROM          (optional) From header, e.g. "ISC SMS <no-reply@…>"
//   FIREBASE_PROJECT_ID(optional) defaults to isc-sms-test
// ─────────────────────────────────────────────────────────────────
import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'isc-sms-test';
const CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

// Cache Google's signing certs across warm invocations.
let _certs = null;
let _certsAt = 0;
async function getGoogleCerts() {
  if (_certs && Date.now() - _certsAt < 60 * 60 * 1000) return _certs;
  const res = await fetch(CERTS_URL);
  if (!res.ok) throw new Error('cert fetch failed');
  _certs = await res.json();
  _certsAt = Date.now();
  return _certs;
}

// Verify a Firebase Auth ID token without the Admin SDK / service account.
async function verifyIdToken(idToken) {
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded?.header?.kid) throw new Error('no kid');
  const certs = await getGoogleCerts();
  const cert = certs[decoded.header.kid];
  if (!cert) throw new Error('unknown kid');
  return jwt.verify(idToken, cert, {
    algorithms: ['RS256'],
    audience: PROJECT_ID,
    issuer: `https://securetoken.google.com/${PROJECT_ID}`,
  });
}

const isEmail = (s) => typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

// ── Branded HTML template ────────────────────────────────────────
// Built server-side from structured fields sent by the app (who
// assigned it, due date, meet link, …) — plain data in, styled and
// escaped HTML out. No third-party template service involved.
const esc = (s) => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

const BRAND_RED  = '#EB1E26';
const BRAND_INK  = '#141417';

function buildHtmlEmail({ subject, heading, intro, text, details, ctaUrl, ctaLabel, fromName }) {
  const rows = (Array.isArray(details) ? details : [])
    .filter(d => d && d.label && d.value)
    .slice(0, 14)
    .map(d => {
      const value = String(d.value).slice(0, 500);
      const isLink = /^https?:\/\/\S+$/i.test(value);
      const valueHtml = isLink
        ? `<a href="${esc(value)}" style="color:${BRAND_RED};word-break:break-all;">${esc(value)}</a>`
        : esc(value).replace(/\n/g, '<br/>');
      return `<tr>
        <td style="padding:9px 14px;border-bottom:1px solid #F0F0F4;font-size:12px;color:#75757F;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap;vertical-align:top;">${esc(d.label)}</td>
        <td style="padding:9px 14px;border-bottom:1px solid #F0F0F4;font-size:14px;color:${BRAND_INK};font-weight:500;">${valueHtml}</td>
      </tr>`;
    }).join('');

  const cta = ctaUrl && /^https?:\/\//i.test(ctaUrl)
    ? `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px auto 0;"><tr><td style="border-radius:9px;background:linear-gradient(135deg,#F4353C 0%,${BRAND_RED} 55%,#C1121A 120%);">
         <a href="${esc(ctaUrl)}" style="display:inline-block;padding:12px 28px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${esc(ctaLabel || 'Open in ISC SMS')}</a>
       </td></tr></table>`
    : '';

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#F4F4F6;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F4F4F6;padding:28px 12px;">
    <tr><td align="center">
      <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#ffffff;border-radius:14px;overflow:hidden;border:1px solid #ECECF1;">
        <tr><td style="background:${BRAND_INK};padding:20px 28px;">
          <span style="display:inline-block;vertical-align:middle;width:12px;height:12px;border-radius:3px;background:${BRAND_RED};margin-right:10px;"></span>
          <span style="font-size:15px;font-weight:700;color:#ffffff;letter-spacing:.06em;text-transform:uppercase;vertical-align:middle;">International Skills Club</span>
        </td></tr>
        <tr><td style="padding:28px 28px 8px;">
          <h1 style="margin:0 0 8px;font-size:20px;color:${BRAND_INK};">${esc(heading || subject)}</h1>
          ${intro ? `<p style="margin:0 0 6px;font-size:14px;line-height:1.6;color:#55555E;">${esc(intro)}</p>` : ''}
          ${!rows && text ? `<p style="margin:8px 0 0;font-size:14px;line-height:1.6;color:#55555E;">${esc(text).replace(/\n/g, '<br/>')}</p>` : ''}
        </td></tr>
        ${rows ? `<tr><td style="padding:12px 28px 4px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ECECF1;border-radius:10px;overflow:hidden;">${rows}</table>
        </td></tr>` : ''}
        <tr><td style="padding:0 28px 30px;" align="center">${cta}</td></tr>
        <tr><td style="padding:16px 28px;background:#FAFAFC;border-top:1px solid #F0F0F4;">
          <p style="margin:0;font-size:12px;line-height:1.6;color:#A6A6B0;">
            ${fromName ? `Sent by ${esc(fromName)} via ` : ''}ISC Student Management System.<br/>
            This is an automated notification — please do not reply to this email.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;
}

// Plain-text mirror of the same structured content (for text-only clients).
function buildTextEmail({ intro, text, details, ctaUrl, fromName }) {
  const lines = [];
  if (intro) lines.push(intro, '');
  if (text && !(Array.isArray(details) && details.length)) lines.push(text, '');
  for (const d of (Array.isArray(details) ? details : [])) {
    if (d && d.label && d.value) lines.push(`${d.label}: ${String(d.value).slice(0, 500)}`);
  }
  if (ctaUrl && /^https?:\/\//i.test(ctaUrl)) lines.push('', `Open in ISC SMS: ${ctaUrl}`);
  if (fromName) lines.push('', `— ${fromName}, ISC SMS`);
  return lines.join('\n');
}

export default async function handler(req, res) {
  // CORS (same-origin in production; permissive for local `vercel dev`)
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ status: 'method-not-allowed' });

  // Feature flag: no creds → do nothing, but succeed so the client's
  // in-app notification flow is never disrupted.
  if (!process.env.MAIL_USER || !process.env.MAIL_APP_PASSWORD) {
    return res.status(200).json({ status: 'disabled' });
  }

  // Auth: require a valid Firebase ID token.
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  if (!token) return res.status(401).json({ status: 'unauthorized' });
  try {
    await verifyIdToken(token);
  } catch {
    return res.status(401).json({ status: 'invalid-token' });
  }

  // Validate payload.
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const { toEmail, subject, text, fromName, heading, intro, details, ctaUrl, ctaLabel } = body;
  if (!isEmail(toEmail)) return res.status(400).json({ status: 'bad-recipient' });
  const safeSubject = String(subject || 'ISC SMS Notification').slice(0, 200);
  const safeText = String(text || '').slice(0, 5000);
  const safe = {
    subject:  safeSubject,
    heading:  heading ? String(heading).slice(0, 200) : '',
    intro:    intro ? String(intro).slice(0, 1000) : '',
    text:     safeText,
    details,
    ctaUrl:   ctaUrl ? String(ctaUrl).slice(0, 500) : '',
    ctaLabel: ctaLabel ? String(ctaLabel).slice(0, 60) : '',
    fromName: fromName ? String(fromName).slice(0, 100) : '',
  };

  try {
    const port = Number(process.env.MAIL_PORT || 465);
    const transporter = nodemailer.createTransport({
      host: process.env.MAIL_HOST || 'smtp.gmail.com',
      port,
      secure: port === 465, // 465 = implicit SSL; 587/25 = STARTTLS
      auth: { user: process.env.MAIL_USER, pass: process.env.MAIL_APP_PASSWORD },
    });
    await transporter.sendMail({
      from: process.env.MAIL_FROM || `ISC SMS <${process.env.MAIL_USER}>`,
      to: toEmail,
      subject: safeSubject,
      text: buildTextEmail(safe) || safeText,
      html: buildHtmlEmail(safe),
    });
    return res.status(200).json({ status: 'sent' });
  } catch (err) {
    return res.status(502).json({ status: 'send-failed', error: String(err.message || err) });
  }
}
