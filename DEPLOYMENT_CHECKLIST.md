# Creative Portal — Deployment Checklist

## First-Time Server Setup

Run these commands in order on the server:

```bash
git pull origin main
chmod +x scripts/server-setup.sh
./scripts/server-setup.sh
echo "PORTAL_INTERNAL_BASE_URL=http://[::1]:3000" >> .env
echo "PORTAL_PUBLIC_BASE_URL=https://internal.univest.in/creative-portal" >> .env
echo "CORS_ALLOWED_ORIGIN=https://internal.univest.in" >> .env
npm run pm2:start
pm2 startup
pm2 save
pm2 list
curl http://[::1]:3000/api/health
```

## Subsequent Deployments

```bash
git pull origin main
npm run deploy
```

## Troubleshooting

| Symptom | Check |
|---|---|
| 401 on `/analytics/api/*` | `PORTAL_INTERNAL_AUTH_TOKEN` in `.env` |
| 502 on long AI calls | nginx `proxy_read_timeout` must be 600s |
| better-sqlite3 failed | `npm rebuild better-sqlite3 --build-from-source` |
| Stale JS in browser | `node scripts/bump-version.js` then hard refresh |
| Service not starting | `pm2 logs [service-name]` |
| 404 on API routes | `pm2 list` and verify all services are online |

## Required ENV Variables

Add these to `.env` and `uploader/.env` on the server:

```env
PORTAL_INTERNAL_BASE_URL=http://[::1]:3000
PORTAL_PUBLIC_BASE_URL=https://internal.univest.in/creative-portal
CORS_ALLOWED_ORIGIN=https://internal.univest.in
NODE_ENV=production
PORTAL_INTERNAL_AUTH_TOKEN=
```
