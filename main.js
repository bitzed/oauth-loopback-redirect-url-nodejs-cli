import { createServer } from 'node:http';
import { randomBytes, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// Fixed values — hardcoded for this PoC. Only client ID + port are configurable.
const HOST = '127.0.0.1';
const CALLBACK_PATH = '/callback';
const AUTHORIZE_URL = 'https://zoom.us/oauth/authorize';
const TOKEN_URL = 'https://zoom.us/oauth/token';
const TIMEOUT_MS = 300_000;

// ── Logging ──────────────────────────────────────────────────────────────────

function log(message) {
  console.log(`${new Date().toTimeString().slice(0, 8)}  ${message}`);
}

/** Show the shape of a secret without leaking it. */
function redact(value, keep = 6) {
  if (!value) return value;
  return `${String(value).slice(0, keep)}…(${String(value).length} chars)`;
}

// ── Step 1: PKCE (RFC 7636) ──────────────────────────────────────────────────

/**
 * code_verifier: high-entropy random string, kept in memory.
 * code_challenge: BASE64URL(SHA256(verifier)) — base64url is unpadded, which
 * Node's 'base64url' encoding already gives us.
 */
function generatePkce() {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

/** Opaque CSRF token. We generate it, Zoom echoes it back, we compare. */
function generateState() {
  return randomBytes(16).toString('base64url');
}

// ── Step 2: the throwaway loopback listener ──────────────────────────────────

const PAGE = (body) => `<!doctype html><meta charset="utf-8"><title>Zoom OAuth</title>
<div style="display:grid;place-items:center;height:100vh;font-family:system-ui,sans-serif;text-align:center">
<div>${body}<p>You can close this tab and return to the terminal.</p></div></div>`;

function startListener({ port }) {
  return new Promise((resolveReady, rejectReady) => {
    let resolveCode;
    let rejectCode;
    const waitForCode = new Promise((res, rej) => {
      resolveCode = res;
      rejectCode = rej;
    });

    const server = createServer((req, res) => {
      const url = new URL(req.url, `http://${HOST}`);
      const keys = [...url.searchParams.keys()];
      log(`Incoming request: ${req.method} ${url.pathname}${keys.length ? `?${keys.join('&')}` : ''}`);

      const params = Object.fromEntries(url.searchParams);
      log(`Captured callback parameters${params.code ? ` · code=${redact(params.code)}` : ''}`);

      if (params.error) {
        res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(PAGE(`<h1>Authorization failed</h1>
          <p>${params.error}: ${params.error_description ?? ''}</p>`));
        finish(() => rejectCode(
          new Error(`Authorization error: ${params.error} — ${params.error_description ?? ''}`)
        ));
        return;
      }

      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(PAGE('<h1>Authorization received &check;</h1>'));
      finish(() => resolveCode(params));
    });

    // Close the socket the moment we are done with it — success or failure.
    // `close()` only stops accepting; a browser's keep-alive connection would
    // hold it open for seconds, so drop live sockets too and the listener is
    // really gone before we go anywhere near the token endpoint.
    const finish = (cb) => {
      clearTimeout(timer);
      log('Closing the loopback listener — its one job is done');
      server.closeAllConnections?.();
      server.close();
      cb();
    };

    const timer = setTimeout(() => {
      finish(() => rejectCode(
        new Error(`No redirect received within ${Math.round(TIMEOUT_MS / 1000)}s`)
      ));
    }, TIMEOUT_MS);

    server.on('error', (err) => rejectReady(err));

    server.listen(port, HOST, () => {
      const actualPort = server.address().port;
      const redirectUri = `http://${HOST}:${actualPort}${CALLBACK_PATH}`;
      const kind = port === 0 ? 'ephemeral' : 'fixed';
      log(`Loopback listener bound to ${HOST}:${actualPort} (${kind} port) → ${redirectUri}`);
      resolveReady({ server, redirectUri, waitForCode, port: actualPort });
    });
  });
}

// ── Steps 3, 5, 6: talking to Zoom ───────────────────────────────────────────

/** Zoom uses the app's build-flow scopes, so no `scope` parameter is sent. */
function buildAuthorizeUrl({ clientId, redirectUri, challenge, state }) {
  const url = new URL(AUTHORIZE_URL);
  const params = {
    response_type: 'code',
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
  };
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/**
 * Trade the authorization code for tokens.
 *
 * A PKCE public client sends client_id + code_verifier in the body and has NO
 * Authorization header — there is no client secret to send.
 */
async function exchangeToken({ clientId, code, redirectUri, verifier }) {
  const fields = {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
    code_verifier: verifier,
  };

  log(`POST ${TOKEN_URL} (no client_secret, no Authorization header)`);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });

  const text = await res.text();
  if (!res.ok) {
    // The body is where Zoom explains itself. Never swallow it.
    throw new Error(`Token endpoint returned HTTP ${res.status}\n          ${text}`);
  }

  const tokens = JSON.parse(text);
  log(`Token endpoint responded HTTP ${res.status} · access=${redact(tokens.access_token)}`);
  return tokens;
}

// ── Browser ──────────────────────────────────────────────────────────────────

/** Open the user's real browser. Never an embedded webview — see RFC 8252 §8.12. */
function openBrowser(url) {
  const [cmd, args] =
    process.platform === 'darwin' ? ['open', [url]]
    : process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : ['xdg-open', [url]];

  log(`Opening the system browser: ${cmd}`);
  execFile(cmd, args, (err) => {
    if (err) {
      log(`Could not launch a browser (${err.message}). Open the URL above manually.`);
    }
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const envFile = path.join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);

  const clientId = process.env.PUBLIC_CLIENT_ID;
  const port = Number(process.env.LOOPBACK_PORT ?? 0) || 0;

  // ── 1. PKCE + state. Nothing has touched the network yet.
  const { verifier, challenge } = generatePkce();
  const state = generateState();
  log(`Generated PKCE + state (S256) · challenge=${challenge} · state=${state}`);

  // ── 2. Listener FIRST — the redirect URI cannot exist until the socket does.
  let listener;
  try {
    listener = await startListener({ port });
  } catch (err) {
    log(`Could not bind ${HOST}:${port} — ${err.message}`);
    if (err.code === 'EADDRINUSE') {
      log('That port is taken. Set LOOPBACK_PORT=0 for an ephemeral port, or pick a free one.');
    }
    return 1;
  }
  const { redirectUri, waitForCode } = listener;

  // ── 3. Send the user to Zoom, in their real browser.
  const authorizeUrl = buildAuthorizeUrl({ clientId, redirectUri, challenge, state });
  log(`\nGenerating Authorize URL from;\nClientID: ${clientId}\nVerifier: ${redact(verifier)}\nRedirect URI: ${redirectUri}\nChallenge: ${challenge}\nState: ${state}`);
  openBrowser(authorizeUrl);
  log(`Waiting for the redirect on ${redirectUri} …`);

  // ── 4. Block until the browser hits the listener.
  let params;
  try {
    params = await waitForCode;
  } catch (err) {
    log(err.message);
    return 1;
  }

  // ── 5. Validate state BEFORE spending the code.
  log(`Validating state (expected=${state}, received=${params.state ?? '(absent)'})`);
  if (params.state !== state) {
    log('State mismatch — possible CSRF. Aborting without redeeming the code.');
    return 1;
  }
  log('State parameter validated');

  // ── 6. Redeem the code for tokens.
  let tokens;
  try {
    tokens = await exchangeToken({
      clientId,
      code: params.code,
      redirectUri,
      verifier,
    });
  } catch (err) {
    log(err.message);
    return 1;
  }

  console.log('access_token:', tokens.access_token);
  console.log('refresh_token:', tokens.refresh_token);
  return 0;
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    log(`Unexpected failure: ${err.stack ?? err.message}`);
    process.exit(1);
  });
