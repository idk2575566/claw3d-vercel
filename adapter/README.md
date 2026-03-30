# Claw3D Gateway Adapter

Minimal Express + WebSocket adapter for hosting a stable `/api/gateway/ws` endpoint on a platform that supports long-lived Node processes (for example Railway or Heroku-style dynos).

## What it does

- Exposes `GET /api/status`
- Exposes `WS /api/gateway/ws`
- Requires a shared client token for incoming WebSocket upgrades
- Connects through to `OPENCLAW_GATEWAY_URL` when configured
- Can run in mock mode for smoke testing

## Required environment variables

- `PORT` - adapter listen port (usually injected by the platform)
- `ADAPTER_CLIENT_TOKEN` - shared secret required from frontend/mobile clients
- `OPENCLAW_GATEWAY_URL` - upstream OpenClaw gateway WebSocket URL, e.g. `wss://gateway.example.com/ws`

## Optional environment variables

- `OPENCLAW_GATEWAY_TOKEN` - bearer token forwarded to the upstream gateway
- `ALLOW_MOCK_GATEWAY` - `true` or `false`; when `true`, `?mock=1` can enable a local echo backend if no upstream is configured

## Local development

```bash
cd adapter
npm install
ADAPTER_CLIENT_TOKEN=change-me ALLOW_MOCK_GATEWAY=true npm run dev
```

Health check:

```bash
curl http://localhost:8080/api/status
```

WebSocket endpoint:

- URL: `ws://localhost:8080/api/gateway/ws?token=change-me`
- Or send `Authorization: Bearer change-me`

## Deploying to Railway

1. Create a new service from the `adapter/` directory.
2. Set the start command to `npm start`.
3. Add env vars:
   - `ADAPTER_CLIENT_TOKEN`
   - `OPENCLAW_GATEWAY_URL`
   - `OPENCLAW_GATEWAY_TOKEN` (if your gateway expects it)
4. Railway injects `PORT` automatically.
5. Use the generated public domain for your frontend WebSocket URL.

## Deploying to Heroku

1. Create a new app.
2. Deploy the contents of `adapter/`.
3. Set config vars:
   - `ADAPTER_CLIENT_TOKEN`
   - `OPENCLAW_GATEWAY_URL`
   - `OPENCLAW_GATEWAY_TOKEN` (optional)
4. Ensure the app uses the default `npm start` process.
5. Heroku injects `PORT` automatically.

## Completing a full deployment

1. Deploy the main Claw3D frontend to Vercel.
2. Deploy this adapter to Railway/Heroku or another Node host with WebSocket support.
3. Generate a strong random value for `ADAPTER_CLIENT_TOKEN`.
4. Point the frontend at the adapter WebSocket URL, for example:
   - `wss://your-adapter.example.com/api/gateway/ws`
5. Pass the shared token from the frontend or edge middleware using:
   - `Authorization: Bearer <ADAPTER_CLIENT_TOKEN>`
   - or `x-adapter-token: <ADAPTER_CLIENT_TOKEN>`
6. If your upstream OpenClaw gateway is protected, also set `OPENCLAW_GATEWAY_TOKEN` on the adapter host.

## Production notes

- Do **not** put `ADAPTER_CLIENT_TOKEN` into Vercel client-exposed env vars.
- Prefer sending the adapter token from a trusted server-side layer.
- Disable mock mode in production: `ALLOW_MOCK_GATEWAY=false`.
- If you need sticky sessions or horizontal scale, terminate clients consistently or move to a shared pub/sub layer.
