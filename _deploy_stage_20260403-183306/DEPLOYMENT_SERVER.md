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

Notes

- The main app starts via `uploader/server.js`.
- Runtime cache/log/database WAL files are intentionally not part of the deploy bundle.
- If the server uses PM2/systemd/NSSM, run `npm start` under that process manager.
