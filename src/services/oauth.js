// OAuth service for Slack and Gmail integrations
import * as db from '../db/index.js';

// OAuth configuration from environment
const OAUTH_CONFIG = {
  slack: {
    clientId: process.env.SLACK_CLIENT_ID,
    clientSecret: process.env.SLACK_CLIENT_SECRET,
    scopes: ['chat:write', 'channels:read', 'users:read'],
    authUrl: 'https://slack.com/oauth/v2/authorize',
    tokenUrl: 'https://slack.com/api/oauth.v2.access'
  },
  gmail: {
    clientId: process.env.GMAIL_CLIENT_ID,
    clientSecret: process.env.GMAIL_CLIENT_SECRET,
    scopes: ['https://www.googleapis.com/auth/gmail.send', 'https://www.googleapis.com/auth/gmail.readonly'],
    authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token'
  }
};

// Get OAuth authorization URL
export function getAuthUrl(provider, sessionId, redirectUri) {
  const config = OAUTH_CONFIG[provider];
  if (!config || !config.clientId) {
    return null;
  }

  const state = Buffer.from(JSON.stringify({ sessionId, provider })).toString('base64');
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    scope: config.scopes.join(' '),
    state,
    response_type: 'code'
  });

  // Gmail-specific params
  if (provider === 'gmail') {
    params.append('access_type', 'offline');
    params.append('prompt', 'consent');
  }

  return `${config.authUrl}?${params.toString()}`;
}

// Exchange authorization code for tokens
export async function exchangeCode(provider, code, redirectUri) {
  const config = OAUTH_CONFIG[provider];
  if (!config || !config.clientId) {
    throw new Error(`OAuth not configured for ${provider}`);
  }

  const params = new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    code,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code'
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString()
  });

  const data = await response.json();

  if (provider === 'slack') {
    if (!data.ok) {
      throw new Error(data.error || 'Slack OAuth failed');
    }
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: 'Bearer',
      scope: data.scope,
      team_id: data.team?.id,
      team_name: data.team?.name
    };
  } else {
    if (data.error) {
      throw new Error(data.error_description || data.error);
    }
    const expiresAt = data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null;
    return {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      token_type: data.token_type || 'Bearer',
      scope: data.scope,
      expires_at: expiresAt
    };
  }
}

// Save token to database
export async function saveToken(sessionId, provider, tokenData) {
  return await db.saveOAuthToken(sessionId, provider, tokenData);
}

// Get token from database
export async function getToken(sessionId, provider) {
  return await db.getOAuthToken(sessionId, provider);
}

// Get all connected integrations for a session
export async function getConnectedIntegrations(sessionId) {
  return await db.getOAuthTokens(sessionId);
}

// Disconnect an integration
export async function disconnect(sessionId, provider) {
  return await db.deleteOAuthToken(sessionId, provider);
}

// Check if provider is configured
export function isConfigured(provider) {
  const config = OAUTH_CONFIG[provider];
  return config && config.clientId && config.clientSecret;
}

// Get configured providers
export function getConfiguredProviders() {
  return Object.keys(OAUTH_CONFIG).filter(p => isConfigured(p));
}

// === Slack API ===
export async function sendSlackMessage(sessionId, channel, text) {
  const token = await getToken(sessionId, 'slack');
  if (!token) {
    throw new Error('Slack not connected');
  }

  const response = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ channel, text })
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to send Slack message');
  }
  return data;
}

export async function getSlackChannels(sessionId) {
  const token = await getToken(sessionId, 'slack');
  if (!token) {
    throw new Error('Slack not connected');
  }

  const response = await fetch('https://slack.com/api/conversations.list?types=public_channel,private_channel', {
    headers: { 'Authorization': `Bearer ${token.access_token}` }
  });

  const data = await response.json();
  if (!data.ok) {
    throw new Error(data.error || 'Failed to get Slack channels');
  }
  return data.channels;
}

// === Gmail API ===
export async function sendGmail(sessionId, to, subject, body) {
  const token = await getToken(sessionId, 'gmail');
  if (!token) {
    throw new Error('Gmail not connected');
  }

  // Create RFC 2822 formatted email
  const email = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body
  ].join('\r\n');

  const encodedEmail = Buffer.from(email).toString('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token.access_token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ raw: encodedEmail })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to send email');
  }
  return await response.json();
}

export async function getGmailMessages(sessionId, maxResults = 10) {
  const token = await getToken(sessionId, 'gmail');
  if (!token) {
    throw new Error('Gmail not connected');
  }

  const response = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${maxResults}`,
    { headers: { 'Authorization': `Bearer ${token.access_token}` } }
  );

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error?.message || 'Failed to get emails');
  }
  return await response.json();
}
