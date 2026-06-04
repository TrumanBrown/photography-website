const { TableClient, AzureSASCredential } = require('@azure/data-tables');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_MESSAGE = 5000;
const TABLE_NAME = 'contactmessages';

module.exports = async function (context, req) {
  // --- Honeypot: hidden "website" field. Humans never fill it; bots do. ---
  if (req.body && req.body.website) {
    // Return fake success so the bot thinks it worked.
    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    };
    return;
  }

  // --- Input validation ---
  const name = (req.body?.name ?? '').trim();
  const email = (req.body?.email ?? '').trim();
  const message = (req.body?.message ?? '').trim();

  const errors = [];
  if (!name) errors.push('Name is required.');
  if (name.length > MAX_NAME) errors.push(`Name must be under ${MAX_NAME} characters.`);
  if (!email) errors.push('Email is required.');
  if (email && !EMAIL_RE.test(email)) errors.push('Email address looks invalid.');
  if (email.length > MAX_EMAIL) errors.push(`Email must be under ${MAX_EMAIL} characters.`);
  if (!message) errors.push('Message is required.');
  if (message.length > MAX_MESSAGE) errors.push(`Message must be under ${MAX_MESSAGE} characters.`);

  if (errors.length) {
    context.res = {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, errors },
    };
    return;
  }

  // --- Write to Azure Table Storage ---
  const connectionString = process.env.AZURE_STORAGE_CONNECTION_STRING;
  if (!connectionString) {
    context.log.error('Missing AZURE_STORAGE_CONNECTION_STRING env var.');
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, errors: ['Contact form is not configured yet. Please try again later.'] },
    };
    return;
  }

  try {
    const client = TableClient.fromConnectionString(connectionString, TABLE_NAME);

    // Partition by year-month for easy browsing; row key is reverse-timestamp
    // so newest messages sort first in Storage Explorer.
    const now = new Date();
    const partitionKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const rowKey = `${String(9999999999999 - now.getTime()).padStart(13, '0')}`;

    await client.createEntity({
      partitionKey,
      rowKey,
      name,
      email,
      message,
      submittedAt: now.toISOString(),
      read: false,
    });

    context.res = {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: true },
    };
  } catch (err) {
    context.log.error('Table Storage write failed:', err.message);
    context.res = {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
      body: { ok: false, errors: ['Failed to send message. Please try again later.'] },
    };
  }
};
