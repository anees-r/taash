/** Email bodies. Inline styles only (mail clients ignore stylesheets); a plain-text twin for every message. */

const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, body) {
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f4efe4;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#1f1836">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4efe4;padding:32px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e8dcc2">
<tr><td style="background:#120e1f;padding:20px 28px;color:#d6b06a;font-size:22px;font-family:Georgia,serif;letter-spacing:.5px">Taash</td></tr>
<tr><td style="padding:28px">
<h1 style="margin:0 0 12px;font-size:20px;color:#1f1836">${esc(title)}</h1>
${body}
</td></tr></table>
<p style="color:#8a7f99;font-size:12px;margin:16px 0 0">Taash · card games with friends</p>
</td></tr></table></body></html>`;
}

/** @param {{name:string, handle:string, link:string, minutes:number}} o */
export function passwordResetEmail(o) {
  const subject = 'Reset your Taash password';
  const html = layout('Reset your password', `
<p style="margin:0 0 16px;line-height:1.5">Hi ${esc(o.name)} (@${esc(o.handle)}), someone asked to reset the password for your Taash account. If it was you, choose a new one:</p>
<p style="margin:0 0 20px"><a href="${esc(o.link)}" style="display:inline-block;background:#d6b06a;color:#241a06;text-decoration:none;font-weight:700;padding:12px 22px;border-radius:999px">Choose a new password</a></p>
<p style="margin:0 0 8px;line-height:1.5;font-size:14px;color:#54417f">The link works once and expires in ${o.minutes} minutes. Resetting signs you out on every device.</p>
<p style="margin:0;line-height:1.5;font-size:14px;color:#54417f">Didn’t ask for this? Ignore this email; your password stays the same.</p>
<p style="margin:20px 0 0;font-size:12px;color:#8a7f99;word-break:break-all">Button not working? Paste this into your browser:<br>${esc(o.link)}</p>`);
  const text = `Hi ${o.name} (@${o.handle}),

Someone asked to reset the password for your Taash account. If it was you, choose a new one here:
${o.link}

The link works once and expires in ${o.minutes} minutes. Resetting signs you out on every device.
Didn't ask for this? Ignore this email; your password stays the same.`;
  return { subject, html, text };
}
