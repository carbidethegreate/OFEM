# Project Setup

## Required Tools
- Node.js 14+
- PostgreSQL
- OnlyFans API key
- OpenAI API key

## Steps
1. Run `npm install`.
2. Configure environment variables via `./setup-env.command` or `node setup-env.js`.
3. Create the database using `./setup-db.command` or `node setup-db.js`.
4. Start the server with `npm start`.

## API Endpoints

### `POST /api/updateFans`
Fetch OnlyFans subscribers and followings, generate Parker names, and upsert them in the database.
- **Request Body:** none (requires `ONLYFANS_API_KEY` and `OPENAI_API_KEY` env vars).
- **Response:** `200` with `{"fans":[{"id":number,"username":string,"name":string,"parker_name":string}]}`.
  Returns `400` with `{ "error": string }` if prerequisites are missing.

### `POST /api/sendMessage`
Send a personalized message to a fan.
- **Request Body:** `{"userId":number,"template":string}`.
- **Response:** `200` with `{ "success": true }` or error status with `{ "success": false, "error": string }`.

### `GET /api/fans`
Retrieve all stored fan records.
- **Request Body:** none.
- **Response:** `200` with `{ "fans": [{ id, username, name, parker_name, ... }] }` where each fan object contains profile and subscription fields.

### `GET /api/status`
Report environment, database, and external service health.
- **Request Body:** none.
- **Response:** `200` with `{ "env": {...}, "database": { ok: boolean }, "onlyfans": { ok: boolean }, "openai": { ok: boolean }, "files": { envFile: boolean }, "node": { version: string } }`.

## Message Template Guidelines

- Available placeholders: `{parker_name}`, `{username}`, `{location}`, `{name}`, and `[name]`.
- Messages are sanitized before sending. Allowed tags: `span`, `strong`, `em`, and `br`.
- `span` tags may only use the following classes: `m-editor-fs__sm`, `m-editor-fs__s`, `m-editor-fs__default`, `m-editor-fs__l`, `m-editor-fs__lg`, `m-editor-fc__gray`, `m-editor-fc__blue-1`, `m-editor-fc__blue-2`.
- Newline characters (`\n`) are automatically converted to `<br>`.
