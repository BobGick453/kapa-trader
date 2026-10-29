// Optional Cloudflare Worker for Kapa Trader's Deriv login.
//
// Deriv's OAuth 2.0 docs say the "code → access token" step should run on a server.
// If Deriv's token endpoint refuses requests coming straight from the browser, deploy this
// worker and paste its URL into Kapa → Connect → OAuth settings → Token exchange URL.
//
// It only forwards token requests to Deriv and only accepts them from your bot's site,
// so it can't be used as a general proxy. It stores nothing.

const DERIV_TOKEN_URL = 'https://auth.deriv.com/oauth2/token';
const ALLOWED_ORIGIN = 'https://bobgick453.github.io';

export default {
  async fetch(request) {
    const cors = {
      'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: cors });
    if (request.headers.get('Origin') !== ALLOWED_ORIGIN) return new Response('Forbidden', { status: 403, headers: cors });

    const body = new URLSearchParams(await request.text());
    if (!['authorization_code', 'refresh_token'].includes(body.get('grant_type'))) {
      return new Response('Unsupported grant_type', { status: 400, headers: cors });
    }
    const upstream = await fetch(DERIV_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    return new Response(await upstream.text(), {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
