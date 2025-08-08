# Project Setup

## Required Tools

- Node.js 22 LTS
- PostgreSQL
- OnlyFans API key
- OpenAI API key

## Steps

1. Run `npm run install-deps`.
2. Configure environment variables via `npm run setup-env` (set `OPENAI_MODEL` to override the default `gpt-4o-mini`).
3. Create the database using `npm run setup-db`.
4. Start the server with `npm run start`.

## API Endpoints

### Usage Sequence

1. `POST /api/refreshFans` – sync subscribers and following users from OnlyFans.
   - Example response:
     ```json
     { "fans": [{ "id": 1, "username": "demo", "parker_name": null }] }
     ```
2. `POST /api/updateParkerNames` – fill in missing `parker_name` values using the configured OpenAI model (default `gpt-4o-mini`).
   - Example response:
     ```json
     { "fans": [{ "id": 1, "username": "demo", "parker_name": "Spark" }] }
     ```
3. `GET /api/fans` – retrieve the full list from the database once names are populated.

### `POST /api/refreshFans`

Fetch OnlyFans subscribers and followings and upsert them in the database without calling OpenAI.

- **Request Body:** none (requires `ONLYFANS_API_KEY`).
- **Response:** `200` with `{ "fans": [{...}] }`.

### `POST /api/updateParkerNames`

Generate Parker names for stored fans missing `parker_name` using the configured OpenAI model.

- **Request Body:** none (requires `OPENAI_API_KEY`; optional `OPENAI_MODEL`).
- **Response:** `200` with `{ "fans": [{...}] }`.

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

### Migration

Earlier versions combined fan syncing and Parker name generation into one endpoint.
Now, call `/api/refreshFans` first and then `/api/updateParkerNames` to populate names.

## Message Template Guidelines

- Available placeholders: `{parker_name}`, `{username}`, `{location}`, `{name}`, and `[name]`.
- Messages are sanitized before sending. Allowed tags: `span`, `strong`, `em`, and `br`.
- `span` tags may only use the following classes: `m-editor-fs__sm`, `m-editor-fs__s`, `m-editor-fs__default`, `m-editor-fs__l`, `m-editor-fs__lg`, `m-editor-fc__gray`, `m-editor-fc__blue-1`, `m-editor-fc__blue-2`.
- Newline characters (`\n`) are automatically converted to `<br>`.
