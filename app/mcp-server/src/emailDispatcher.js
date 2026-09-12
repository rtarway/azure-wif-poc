// Outbound Email Dispatcher Module
// Supports SendGrid v3 API, Resend API, and direct HTTPS relay for Option 1 delivery.

const https = require('https');

/**
 * Dispatch an email to a recipient via SendGrid, Resend, or configured relay.
 * @param {Object} options
 * @param {string} options.recipient - Target email address (e.g. rtarway@gmail.com)
 * @param {string} options.subject - Email subject line
 * @param {string} options.body - Email plain text content
 * @param {Object} [options.config] - Optional config override from client (apiKey, provider, fromEmail)
 * @returns {Promise<Object>} Delivery result metadata
 */
async function dispatchRealEmail({ recipient, subject, body, config = {} }) {
  const sendgridKey = config.sendgridApiKey || process.env.SENDGRID_API_KEY;
  const resendKey = config.resendApiKey || process.env.RESEND_API_KEY;
  const customFrom = config.fromEmail || process.env.EMAIL_FROM;

  // 1. Resend Dispatcher (Recommended: 100 free emails/day, no credit card required)
  if (resendKey) {
    return await sendViaResend({
      apiKey: resendKey,
      from: customFrom || 'onboarding@resend.dev',
      to: recipient,
      subject,
      body
    });
  }

  // 2. SendGrid v3 API Dispatcher (100 free emails/day)
  if (sendgridKey) {
    return await sendViaSendGrid({
      apiKey: sendgridKey,
      from: customFrom || 'azure-wif-agent@poc.internal',
      to: recipient,
      subject,
      body
    });
  }

  // 3. Fallback when keys are not yet configured
  return {
    delivered: false,
    provider: 'unconfigured',
    notice: 'Real email dispatcher is armed and waiting for API key.',
    instructions: 'Provide SENDGRID_API_KEY or RESEND_API_KEY in .env or enter it in the Web UI Settings card to deliver physical emails to ' + recipient,
    targetRecipient: recipient,
    dispatchedAt: new Date().toISOString()
  };
}

/**
 * Send email using Resend API (https://resend.com)
 */
function sendViaResend({ apiKey, from, to, subject, body }) {
  return new Promise(resolve => {
    const payload = JSON.stringify({
      from,
      to: [to],
      subject,
      text: body
    });

    const req = https.request(
      'https://api.resend.com/emails',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      },
      res => {
        let resData = '';
        res.on('data', chunk => (resData += chunk));
        res.on('end', () => {
          let parsed;
          try {
            parsed = JSON.parse(resData);
          } catch {
            parsed = { raw: resData };
          }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({
              delivered: true,
              provider: 'Resend',
              statusCode: res.statusCode,
              messageId: parsed.id,
              recipient: to,
              dispatchedAt: new Date().toISOString()
            });
          } else {
            resolve({
              delivered: false,
              provider: 'Resend',
              statusCode: res.statusCode,
              error: parsed.message || parsed.error || resData,
              recipient: to
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ delivered: false, provider: 'Resend', error: 'Connection timed out' });
    });

    req.on('error', err => {
      resolve({ delivered: false, provider: 'Resend', error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

/**
 * Send email using SendGrid v3 API (https://sendgrid.com)
 */
function sendViaSendGrid({ apiKey, from, to, subject, body }) {
  return new Promise(resolve => {
    const payload = JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: { email: from },
      subject,
      content: [{ type: 'text/plain', value: body }]
    });

    const req = https.request(
      'https://api.sendgrid.com/v3/mail/send',
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload)
        },
        timeout: 6000
      },
      res => {
        let resData = '';
        res.on('data', chunk => (resData += chunk));
        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            const messageId = res.headers['x-message-id'] || 'sg-' + Date.now();
            resolve({
              delivered: true,
              provider: 'SendGrid',
              statusCode: res.statusCode,
              messageId,
              recipient: to,
              dispatchedAt: new Date().toISOString()
            });
          } else {
            let parsed;
            try {
              parsed = JSON.parse(resData);
            } catch {
              parsed = { raw: resData };
            }
            resolve({
              delivered: false,
              provider: 'SendGrid',
              statusCode: res.statusCode,
              error: parsed.errors?.[0]?.message || parsed.message || resData,
              recipient: to
            });
          }
        });
      }
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ delivered: false, provider: 'SendGrid', error: 'Connection timed out' });
    });

    req.on('error', err => {
      resolve({ delivered: false, provider: 'SendGrid', error: err.message });
    });

    req.write(payload);
    req.end();
  });
}

module.exports = {
  dispatchRealEmail,
  sendViaResend,
  sendViaSendGrid
};
