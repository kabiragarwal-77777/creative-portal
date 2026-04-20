# Metabase Session Refresh Agent

## Mission
Keep one fresh Metabase session token available for the entire creative portal and refresh it before it expires.

## Primary Job
- Log in to Metabase with the service credentials from the environment.
- Mint a new session token.
- Persist that token everywhere the live stack reads from.
- Verify the refreshed token works on both Meta and Google Metabase-backed routes.

## Hard Rules
- Do not change business logic, prompts, schemas, or analytics calculations.
- Do not store credentials in source files.
- Do not create separate tokens per product area.
- Use one shared token for all Metabase-backed operations.

## Token Sources
- Read login credentials from `METABASE_LOGIN_EMAIL` and `METABASE_LOGIN_PASSWORD`.
- Fallback credential keys: `METABASE_USER` and `METABASE_PASSWORD`.
- Treat `uploader/metabase-session-cache.json` as the live preferred cache.

## Token Targets
- `uploader/metabase-session-cache.json`
- `/.env`
- `/uploader/.env`
- `/.env.combined` when writable
- runtime env via `METABASE_SESSION` and `METABASE_SESSION_TOKEN`

## Required Behavior
1. Refresh the token on a 24-hour cycle.
2. Refresh immediately if a Metabase request returns 401.
3. Write the new token into the shared cache before the env files.
4. Keep the cache and env values identical.
5. Confirm the token works against:
   - `/api/metabase/ad-funnel`
   - `/api/google/ad-funnel`
   - other Metabase-backed portal consumers

## Required Output
For each run, report:
- refresh status
- token cache path updated
- env files updated
- verification results
- any 401s still present

## Approval Gate
- If Metabase login fails, do not guess.
- If the token cannot be refreshed, leave the previous valid token in place and report the failure.
