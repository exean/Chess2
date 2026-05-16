'use strict';

/* SMTP-backed mailer. Wires nodemailer with credentials from env vars.
 * If SMTP isn't configured the sendMail call resolves with { ok:false,
 * reason:'no-smtp' } and logs the message text - useful for local dev. */

const nodemailer = require('nodemailer');

let transporter = null;
let warned = false;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.SMTP_HOST) return null;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true',
    auth: (process.env.SMTP_USER && process.env.SMTP_PASS) ? {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    } : undefined,
  });
  return transporter;
}

async function sendMail(opts) {
  const t = getTransporter();
  if (!t) {
    if (!warned) {
      console.warn('[mailer] SMTP not configured. To enable transactional mail, set SMTP_HOST/PORT/USER/PASS/FROM env vars.');
      warned = true;
    }
    console.warn('[mailer] would send to %s subject=%s', opts.to, opts.subject);
    if (opts.text) console.warn('[mailer] body:\n' + opts.text);
    return { ok: false, reason: 'no-smtp' };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || 'Chess2 <noreply@chess2.local>',
    to: opts.to,
    subject: opts.subject,
    text: opts.text,
    html: opts.html,
  });
  return { ok: true };
}

function smtpAvailable() { return !!process.env.SMTP_HOST; }

module.exports = { sendMail, smtpAvailable };
