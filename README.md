<!-- Modified 2025-08-02 – v1.0 -->

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
- PostgreSQL (PostgreSQL App works great on macOS)
- OnlyFans API key
- OpenAI API key

## Setup

1. **Install dependencies**

   ```bash
   ./install.command
   ```

2. **Create the database automatically**

   Double‑click `predeploy.html` and press **Set up new database**. A Terminal window
   opens, creates the database, and updates your `.env` file with random credentials.
   Keep the window open until it says “Database setup complete!”, then open `.env`
   and fill in your OnlyFans and OpenAI API keys.

   If you already have a PostgreSQL database configured, you can instead run:

   ```bash
   node migrate.js
   ```

   This creates the required `fans` table using your existing credentials.

3. **Start the server**

   ```bash
   ./start.command
   ```

   The server listens on <http://localhost:3000> by default.

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

<!-- End of File – Last modified 2025-08-02 -->
