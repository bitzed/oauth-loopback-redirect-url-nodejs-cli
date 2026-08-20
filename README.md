> ⚠️ The following sample application is a personal, open-source project shared by the app creator and not an officially supported Zoom Communications, Inc. sample application. Zoom Communications, Inc., its employees and affiliates are not responsible for the use and maintenance of this application. Please use this sample application for inspiration, exploration and experimentation at your own risk and enjoyment. You may reach out to the app creator and broader Zoom Developer community on https://devforum.zoom.us/ for technical discussion and assistance, but understand there is no service level agreement support for this application. Thank you and happy coding!

> ⚠️ このサンプルのアプリケーションは、Zoom Communications, Inc.の公式にサポートされているものではなく、アプリ作成者が個人的に公開しているオープンソースプロジェクトです。Zoom Communications, Inc.とその従業員、および関連会社は、本アプリケーションの使用や保守について責任を負いません。このサンプルアプリケーションは、あくまでもインスピレーション、探求、実験のためのものとして、ご自身の責任と楽しみの範囲でご活用ください。技術的な議論やサポートが必要な場合は、アプリ作成者やZoom開発者コミュニティ（ https://devforum.zoom.us/ ）にご連絡いただけますが、このアプリケーションにはサービスレベル契約に基づくサポートがないことをご理解ください。

# Zoom OAuth — Loopback Redirect URI + PKCE (Node.js CLI)

A **minimal, dependency-free** proof-of-concept for Zoom's
[**"Using a loopback redirect URI"**](https://developers.zoom.us/docs/integrations/oauth/)
flow — the [RFC 8252](https://datatracker.ietf.org/doc/html/rfc8252) pattern for
native / desktop / CLI apps that cannot expose a publicly reachable HTTPS callback.

One file. **Node standard library only** — no `npm install`, no `node_modules`.

Python port: [oauth-loopback-redirect-url-python](https://github.com/bitzed/oauth-loopback-redirect-url-python).

---

## What is a loopback redirect URI?

Instead of registering a public `https://…/callback` endpoint, a native app:

1. Starts a **temporary local HTTP server** bound to the loopback interface
   (`127.0.0.1`), ideally on an **ephemeral port** (`:0`).
2. Reads the port the OS assigned and builds the redirect URI from it,
   e.g. `http://127.0.0.1:52936/callback`.
3. Opens the **system browser** to Zoom's authorize endpoint.
4. Captures `code` and `state` when the browser is redirected back to the local server.
5. Exchanges the code for tokens using **PKCE** (no client secret).
6. **Shuts the listener down immediately.**

```
  main.js                          System browser                 Zoom
     │                                   │                          │
     ├─ 1. PKCE verifier + challenge     │                          │
     ├─ 2. bind 127.0.0.1:PORT ──────┐   │                          │
     ├─ 3. open authorize URL ───────┼──▶│──── /oauth/authorize ───▶│
     │                               │   │◀─── consent screen ──────┤
     │   4. ?code=…&state=…  ◀───────┴───┤◀─── 302 to 127.0.0.1 ────┤
     ├─ 5. validate state                │                          │
     ├─ 6. POST /oauth/token ────────────┼─────────────────────────▶│
     │      client_id + code_verifier    │      (no client secret)  │
     │◀─────────────────────────────── access_token ────────────────┤
```

### Eligibility

> Loopback redirect is for **PKCE-enabled clients or native app clients**, not standard
> confidential OAuth clients. Apps that are not PKCE-enabled must keep using HTTPS
> redirect URIs, and will see `Invalid redirect: <redirectUri>` from the authorize
> endpoint.

---

## Requirements

- **Node.js 20.12.0 or later** — the script uses `process.loadEnvFile()` to read `.env`
  without any dependency.
- A Zoom account with developer permissions.

---

## Zoom App Marketplace setup

### 1. Create a General app

1. Sign in to the [Zoom App Marketplace](https://marketplace.zoom.us/).
2. In the lower-left navigation pane, click **Developer**.
   (If the link is missing, ask your admin for the **Zoom for developers** role.)
3. On the **Created apps** page, click **Develop** → **Build an app**.
4. Select **General app** → **Create**.

### 2. Turn on Public Client OAuth

1. Go to **Basic Information** → **App Credentials**.
2. Toggle **Use Public Client OAuth** to **on**.
3. Copy the **Public Client ID**. A public client needs **no client secret**.

> Development and production credentials are separate. While testing, use the
> **Development** environment filter and its Public Client ID.

### 3. Register the loopback redirect URI

Under **Basic Information** → **OAuth Information**:

| Field | Value |
| --- | --- |
| **OAuth Redirect URL** (required) | `http://127.0.0.1/callback` |
| **OAuth Allow List** (required) | `http://127.0.0.1/callback` |

**Zoom matches loopback redirect URIs while ignoring only the port.** The scheme,
numeric loopback host, path, query, fragment, and user info must otherwise match the
registered URI exactly. That is what makes a fresh ephemeral port on every run
possible — you register the URI once, with or without a port, and the runtime port
does not have to match.

These forms are all accepted for PKCE / native-style clients:

```
http://127.0.0.1
http://127.0.0.1:3000
http://127.0.0.1/callback
http://127.0.0.1:8080/callback
http://[::1]
http://[::1]:60123/callback
```

> **Use `127.0.0.1`, not `localhost`.** The loopback IP literal avoids DNS resolution
> issues and unintended network exposure; RFC 8252 explicitly recommends against
> `localhost`. Note that `127.0.0.1` and `[::1]` are both supported but are matched as
> **different hosts** — this sample uses `127.0.0.1`, so register that one.

> **Loopback URLs are for development.** Zoom's documentation advises against using
> loopback or other local endpoints as *production* redirects; they may be rejected
> during Marketplace publishing review.

### 4. Add scopes

On the **Scopes** page, select the scopes your app needs (e.g. `user:read:user`).
This sample sends no `scope` parameter — Zoom uses the scopes configured in the app's
build flow.

### 5. Add the app to your own account

On the **Local Test** page, click **Add App Now** → **Allow**.

---

## Run it

```bash
git clone https://github.com/bitzed/oauth-loopback-redirect-url-nodejs-cli.git
cd oauth-loopback-redirect-url-nodejs-cli
cp .env.example .env
```

Edit `.env`:

```dotenv
PUBLIC_CLIENT_ID=your_public_client_id
LOOPBACK_PORT=0
```

```bash
node main.js
# or: npm start
```

Your system browser opens Zoom's consent screen. Click **Allow** — the terminal prints
the authorize parameters and, after the redirect, the tokens.

### Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `PUBLIC_CLIENT_ID` | — | Required. The Public Client ID from App Credentials. |
| `LOOPBACK_PORT` | `0` | `0` asks the OS for a fresh ephemeral port — the recommended setting. Set a fixed port only when you need a predictable URI for debugging; if that port is busy the script falls back to an ephemeral one. |

### Sample output

```text
11:11:39  Generated PKCE + state (S256) · challenge=U7MocU9… · state=HbIwfZi…
11:11:39  Loopback listener bound to 127.0.0.1:52936 (ephemeral port) → http://127.0.0.1:52936/callback
11:11:39
Generating Authorize URL from;
ClientID: AbCdEf…
Verifier: NXyuma…(43 chars)
Redirect URI: http://127.0.0.1:52936/callback
Challenge: U7MocU9CRMYcXsYInE402mzFwFCbaUA-Qz5xJlW9E-w
State: HbIwfZi71jlISUBh-peNew
11:11:39  Opening the system browser: open
11:11:39  Waiting for the redirect on http://127.0.0.1:52936/callback …
11:11:46  Incoming request: GET /callback?code&state
11:11:46  Captured callback parameters · code=hK3mZ9…(64 chars)
11:11:46  Closing the loopback listener — its one job is done
11:11:46  Validating state (expected=HbIwfZi…, received=HbIwfZi…)
11:11:46  State parameter validated
11:11:46  POST https://zoom.us/oauth/token (no client_secret, no Authorization header)
11:11:47  Token endpoint responded HTTP 200 · access=eyJzdi…(1052 chars)
access_token: eyJzdi…
refresh_token: eyJhbG…
```

Secrets are redacted in the log — only the first few characters and the length are
printed, so you can see the *shape* of a value without leaking it.

> The consent screen appears on **every** authorization for public clients. This is
> intentional, per
> [RFC 6819 §5.2.3.2](https://datatracker.ietf.org/doc/html/rfc6819#section-5.2.3.2),
> and prevents silent authorization. It applies to the
> `grant_type=authorization_code` exchange only — **not** to the refresh token flow.

---

## What the code does

Everything lives in [`main.js`](main.js), in the order the flow actually happens:

| Step | Function | Notes |
| --- | --- | --- |
| 1 | `generatePkce()` | 32 random bytes → `code_verifier`; `SHA-256` → `code_challenge`. Node's `'base64url'` encoding is already unpadded. |
| 1 | `generateState()` | Opaque CSRF token. We generate it, Zoom echoes it back, we compare. |
| 2 | `startListener()` | Binds **first** — the redirect URI cannot exist until the socket does. Returns the URI and a promise that settles when the browser arrives. |
| 3 | `buildAuthorizeUrl()` | `response_type`, `client_id`, `redirect_uri`, `code_challenge`, `code_challenge_method=S256`, `state`. |
| 3 | `openBrowser()` | `open` / `xdg-open` / `start`. Never an embedded webview — see [RFC 8252 §8.12](https://datatracker.ietf.org/doc/html/rfc8252#section-8.12). |
| 4 | — | The listener resolves with the callback query parameters, then closes itself. |
| 5 | — | `state` is validated **before** the code is redeemed. |
| 6 | `exchangeToken()` | `application/x-www-form-urlencoded` body, **no `Authorization` header**, `client_id` and `code_verifier` in the body. |

A few details worth pointing out:

- **`server.closeAllConnections()`** is called alongside `close()`. `close()` only stops
  accepting new connections; a browser's keep-alive socket would hold the listener open
  for seconds afterwards. We want it gone before we go anywhere near the token endpoint.
- **The timeout starts only after `listen()` succeeds** (5 minutes). A timer left running
  from a failed bind attempt would later reject a promise nobody is awaiting.
- **The token endpoint's response body is never swallowed.** Zoom explains itself in the
  `reason` field; the HTTP status alone is rarely enough to debug a failure.

### Public client vs. confidential client

| | Confidential client | Public client (PKCE) |
| --- | --- | --- |
| `Authorization` header | `Basic base64(id:secret)` | **none** |
| `client_id` | in the header | **in the body** |
| `client_secret` | required | **not used** |
| `code_verifier` | — | **required** |

---

## Security notes

- Bind to **`127.0.0.1`**, never `0.0.0.0` — otherwise other machines on the LAN can
  reach your listener and steal the authorization code.
- Validate `state` **before** redeeming the code.
- Close the listener as soon as the response arrives, and time out if it never does.
- Always send `code_challenge_method=S256`. Omitting it defaults to `plain`.
- Use the system browser, not an embedded webview.
- Do not cache or reuse the listener port — take a fresh ephemeral port per attempt.
- Never log tokens or the `code_verifier` in full.
- In a real app, store the `refresh_token` in OS-provided secure storage (Keychain,
  Credential Manager, Secret Service), not a plaintext file.

---

## Troubleshooting

| Symptom | Likely cause |
| --- | --- |
| `Invalid redirect: <redirectUri>` | The app is not PKCE-enabled, or the scheme/host/path does not match the registered URI. Remember only the **port** is ignored. |
| Browser opens but nothing comes back | You registered or used `localhost` instead of `127.0.0.1`, and it resolved to `::1`. |
| `PUBLIC_CLIENT_ID is not set` | `.env` is missing or empty — `cp .env.example .env`. |
| HTTP 400 `invalid_client` | Wrong Public Client ID, or development/production credentials mixed up. |
| HTTP 400 on token exchange | `code_verifier` mismatch, or an `Authorization` header was sent. Public clients send neither a secret nor that header. |
| Consent screen appears every time | Expected for public clients. Persist the `refresh_token`. |

---

## Related

- [OAuth 2.0 — Zoom Developer Docs](https://developers.zoom.us/docs/integrations/oauth/)
- [OAuth Information (Redirect URL, Allow List)](https://developers.zoom.us/docs/build-flow/basic-info/oauth-info/)
- [App Credentials (Public Client OAuth)](https://developers.zoom.us/docs/build-flow/basic-info/app-credentials/)
- [RFC 8252 — OAuth 2.0 for Native Apps](https://datatracker.ietf.org/doc/html/rfc8252)
- [RFC 7636 — Proof Key for Code Exchange](https://datatracker.ietf.org/doc/html/rfc7636)
- Python port: [oauth-loopback-redirect-url-python](https://github.com/bitzed/oauth-loopback-redirect-url-python)

## License

MIT
