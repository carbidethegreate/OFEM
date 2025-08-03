<!-- Modified 2025-08-05 – v1.0 -->

# OnlyFans Express Messenger (OFEM)

OFEM is a small dashboard that helps an OnlyFans creator greet fans by name and send a
personalised message to everyone in one pass.  It uses the official OnlyFans API to
fetch the fan list and send direct messages and OpenAI GPT‑4 to generate friendly
nicknames.

## Features

- **Update Fan Names** – Fetches all fans and assigns each a short “Parker name” using
  GPT‑4 according to the rules in the project plan.  Names can be edited and saved.
- **Send Personalised DM** – Sends a message to every fan, greeting each with their
  Parker name.  Shows a green dot for success and red for failure.  Sending can be
  aborted and auto‑stops after ten consecutive errors.

## Prerequisites

- Node.js 14+
- PostgreSQL database accessible via `DATABASE_URL`
- OnlyFans API key
- OpenAI API key

## Setup

1. **Install dependencies**

   ```bash
   npm install
   ```

2. **Configure environment**

   Run `./setup-env.command` (macOS) or `node setup-env.js` to enter your OnlyFans and
   OpenAI API keys. This creates a `.env` file. The database setup wizard will add the
   database credentials later.

3. **Start PostgreSQL (Docker)**

   A `docker-compose.yml` is provided to launch a local database quickly:

   ```bash
   docker compose up -d db
   ```

   The default connection string is
   `postgres://postgres:postgres@localhost:5432/ofdb`.

4. **Start the server**

   ```bash
   npm start
   ```

   The server listens on <http://localhost:3000> by default.  A convenience script
   `start.command` (macOS) runs `npm install` if needed and then launches the server.

## Usage

1. Open a browser to <http://localhost:3000>.
2. Click **Update Fan Names** to load fans and generate Parker names.
3. Edit any names and click **Save** beside a fan to persist the change.
4. Type the message to broadcast.  Use `{name}` or `[name]` as a placeholder or leave
   it out to have the greeting prefixed automatically.
5. Click **Send Personalised DM to All Fans** to start sending.  Use **Abort Sending**
   to stop early.

## Notes

- All OnlyFans and OpenAI requests happen server‑side; API keys are never exposed in the
  browser.
- Message sending is rate‑limited (500 ms delay between fans) to reduce the chance of
  hitting OnlyFans rate limits.
- The project currently supports only the two features described above but is structured
  to allow further expansion.

<!-- End of File – Last modified 2025-08-05 -->
