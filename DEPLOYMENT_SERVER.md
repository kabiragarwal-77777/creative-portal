Deployment steps

1. Unzip the project on the server.
2. Ensure Node.js 18+ is installed.
3. Copy the required env files:
   - `.env`
   - `uploader/.env`
4. Install dependencies from the project root:

```powershell
npm install
```

This will also install dependencies for:
- `uploader`
- `intelligence`
- `inventory-scanner`
- `google-creative`

5. Start the main portal:

```powershell
npm start
```

Deployment contract

- The portal must use same-origin runtime URLs in browser code.
- Do not hardcode `localhost` in production-facing portal modules.
- If a service must be reached cross-process, read the base URL from env first and fall back to loopback only when the service is expected to run on the same host.
- Keep Meta, Google, Campaign Tree, Audience Testing, and Intelligence on the same selected date range and scope rules as the internal server.

Notes

- The main app starts via `uploader/server.js`.
- Runtime cache/log/database WAL files are intentionally not part of the deploy bundle.
- If the server uses PM2/systemd/NSSM, run `npm start` under that process manager.
- Before release, verify:
  - Meta portal loads and matches internal totals
  - Google portal loads and matches internal totals
  - Campaign Tree, Optimizer, Audience Testing, and Intelligence render without stale cache errors
  - Metabase auth is valid
  - browser bundles are fresh after deployment
