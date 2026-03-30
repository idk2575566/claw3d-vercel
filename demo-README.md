Claw3D - Local demo with mock OpenClaw gateway

Local preview URL (default): http://localhost:3000/
Mock OpenClaw gateway state endpoint: http://localhost:4001/state

Steps to reproduce

1. Clone repository (already done here):
   git clone https://github.com/iamlukethedev/Claw3D

2. Install dependencies:
   cd Claw3D
   npm ci

3. Start the mock OpenClaw gateway (returns sample agent state):
   node mock-gateway.js
   - Opens: http://localhost:4001/state

4. Start the Claw3D dev server:
   npm run dev
   - App default: http://localhost:3000/

Notes

- The mock gateway provides a simple JSON payload at /state with sample agents.
- The dev server in this repo uses server/index.js; when run with --dev it starts Next.js in dev mode.
- If ports 3000 or 4001 are in use, set GATEWAY_PORT env for the mock gateway and NEXT_PORT for the app if needed.

Logs

- mock-gateway started at: http://localhost:4001/state
- dev server started via: npm run dev (server/index.js --dev)

Contact

This demo was prepared automatically by a subagent for quick local previews.
