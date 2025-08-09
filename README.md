<!-- Modified 2025-02-15 – v1.1 -->

# OnlyFans Express Messenger (OFEM)

OFEM is a small dashboard that helps an OnlyFans creator greet fans by name and send a
personalised message to everyone in one pass. It uses the official OnlyFans API to
fetch the fan list and send direct messages and an OpenAI GPT model (default `gpt-4o-mini`) to generate friendly
nicknames.

> **macOS users:** This repo includes several `.command` files (e.g., `install.command`, `setup-env.command`, `setup-db.command`, `start.command`) so non-technical Mac users can set up and run OFEM by double-clicking. **Never remove these `.command` files without the project owner's explicit approval.** For a guided walkthrough, open `predeploy.html` and follow the on-screen buttons.

## Features

- **Update Fan List** – Fetches all subscribers and followings and stores them in the
  database without calling OpenAI.
- **Update Parker Names** – Generates a short “Parker name” with the configured OpenAI model (default `gpt-4o-mini`) only for fans who
  do not already have one. Names can be edited and saved.
- **Send Personalised DM** – Sends a message to every fan, greeting each with their
  Parker name. Shows a green dot for success and red for failure. Sending can be
  aborted and auto‑stops after ten consecutive errors.
- **Schedule Messages & Review History** – Queue messages for later and browse past
  sends from a built-in history view.
- **Pay-Per-View (PPV) Templates** – Create, manage, and send paid messages with
  optional scheduling and per-message pricing.
- **Vault Media & Lists** – Upload media, scrape external URLs, and organise items
  into reusable lists for composing messages.

## Prerequisites

- Node.js 22 LTS (>=22.0.0)
- PostgreSQL database accessible via `DATABASE_URL`
- OnlyFans Pro API key – includes everything in Basic plus 75,000 free monthly credits,
  1,000 requests per minute, the ability to connect up to five OnlyFans accounts for free
  (then $29/month per additional account), real-time webhooks, priority support, and
  advanced API features.
- OpenAI API key

> We recommend using a Node version manager like [nvm](https://github.com/nvm-sh/nvm) to install and switch between Node.js versions.

## Setup

1. **Install dependencies**

   ```bash
   npm run install-deps
   ```

   This command detects your OS and installs Node.js, Docker, and project packages. If you already have these installed, run `npm install` instead.

2. **Configure environment**

   Run `npm run setup-env` to enter your OnlyFans and
   OpenAI API keys, database credentials, and admin credentials. This creates a `.env`
   file.

   Supplying database connection details and admin credentials now lets you reuse an
   existing PostgreSQL database and skip the `npm run setup-db` step.

### Environment Variables

The server reads the following variables from your environment or `.env` file:

- `ONLYFANS_API_KEY` – authenticates requests to the OnlyFans API. A Pro account
  includes everything in Basic plus 75,000 free monthly credits, 1,000 requests per
  minute, the ability to connect up to five OnlyFans accounts for free (then $29/month
  per additional account), real-time webhooks, priority support, and advanced API
  features. The server verifies this key at startup and exits if it is missing or
  invalid.
- `OPENAI_API_KEY` – enables OpenAI GPT models for generating Parker names (required only
  for `/api/updateParkerNames`).
- `OPENAI_MODEL` – OpenAI model to use for Parker name generation (default `gpt-4o-mini`).
- `DB_NAME` – name of the PostgreSQL database to use.
- `DB_USER` – PostgreSQL username.
- `DB_PASSWORD` – password for the database user.
- `DB_HOST` – host address of the PostgreSQL server.
- `DB_PORT` – port number where PostgreSQL listens.
- `OF_FETCH_LIMIT` – optional cap on OnlyFans records fetched per sync (default 1000).

The `/api/status` endpoint reports whether each variable has been configured.

3. **Create the database**

   Run `npm run setup-db` to spin up PostgreSQL via Docker
   (if needed), create a database with a random name, and write the credentials to your
   `.env` file. This step is unnecessary if you provided existing database credentials in
   the previous step. The script verifies required Node modules such as `pg` (used for
   JSONB operations) and `dotenv`, installing them automatically if missing.

   When upgrading an existing database, remember to run
   `node migrate_add_fan_fields.js`, `node migrate_messages.js`,
   `node migrate_scheduled_messages.js`, `node migrate_add_ppv_tables.js`,
   `node migrate_add_ppv_schedule_fields.js`,
   `node migrate_add_ppv_message_field.js`, and
   `node migrate_add_ppv_sends.js` to add any new columns and tables that may be
   required.

4. **Start the server**

   ```bash
   npm run start
   ```

   The server listens on <http://localhost:3000> by default. To use a different port,
   set the `PORT` environment variable before starting, for example:

   ```bash
   PORT=8080 npm run start
   ```

   You can also define `PORT` in your `.env` file. The start script automatically runs any pending database migrations. To apply migrations manually, run `npm run migrate`.

## Docker

A `Dockerfile` and `docker-compose.yml` are included for containerised
development.

1. **Build the image**

   ```bash
   docker build -t ofem-app .
   ```

2. **Run the app and database**

   Ensure `ONLYFANS_API_KEY` and `OPENAI_API_KEY` are set in your environment
   and then start the services:

   ```bash
   docker compose up --build
   ```

   The server will be available at <http://localhost:3000>.

## Fan Fields Migration and New Columns

Run the migration scripts below to ensure your database includes all of the latest fan
profile fields, message-history schema, scheduled message tables, and PPV schedule
support.

```bash
node migrate_add_fan_fields.js
node migrate_messages.js
node migrate_scheduled_messages.js
node migrate_add_ppv_tables.js
node migrate_add_ppv_schedule_fields.js
node migrate_add_ppv_message_field.js
node migrate_add_ppv_sends.js
```

These scripts read connection details from your `.env` file. `migrate_add_fan_fields.js`
adds any missing columns to the `fans` table, `migrate_messages.js` creates a
`messages` table, `migrate_scheduled_messages.js` adds scheduling tables, and the
PPV migrations create and extend PPV-related tables. The new `fans` columns and
their purposes are:

- `avatar` – URL to the fan's profile avatar
- `header` – URL to the profile header image
- `website` – External website link
- `location` – Fan‑reported location
- `gender` – Gender value from the profile
- `birthday` – Birth date
- `about` – Bio text
- `notes` – Creator notes about the fan
- `lastSeen` – Timestamp of the fan's last activity
- `joined` – Date the fan joined OnlyFans
- `canReceiveChatMessage` – Whether the fan can receive chat messages
- `canSendChatMessage` – Whether the fan can send chat messages
- `isBlocked` – Fan is blocked by the creator
- `isMuted` – Fan is muted in chats
- `isRestricted` – Fan is restricted from certain interactions
- `isHidden` – Profile is hidden from the creator
- `isBookmarked` – Fan is bookmarked
- `isSubscribed` – Active subscription status
- `subscribedBy` – Who initiated the subscription
- `subscribedOn` – When the subscription started
- `subscribedUntil` – Subscription expiration date
- `renewedAd` – Subscription renewed via advertisement
- `isFriend` – Fan is marked as a friend
- `tipsSum` – Total amount the fan has tipped
- `postsCount` – Number of posts created by the fan
- `photosCount` – Number of photos posted
- `videosCount` – Number of videos posted
- `audiosCount` – Number of audio posts
- `mediaCount` – Total media items posted
- `subscribersCount` – Number of subscribers the fan has
- `favoritesCount` – Number of posts the fan has favorited
- `avatarThumbs` – JSON with resized avatar URLs
- `headerSize` – JSON describing header dimensions
- `headerThumbs` – JSON with resized header URLs
- `listsStates` – JSON with list membership information
- `subscribedByData` – JSON describing subscription origin
- `subscribedOnData` – JSON describing subscription timing
- `promoOffers` – JSON describing active promotional offers
- `updatedAt` – Timestamp of the last record update

`migrate_messages.js` creates a `messages` table used for storing message history:

- `id` – serial primary key
- `fan_id` – reference to `fans.id`
- `direction` – 'sent' or 'received'
- `body` – message text
- `price` – media price
- `created_at` – timestamp when the message was created

Run `npm run migrate` to
apply all migrations to an existing database in one step.

## Usage

1. Open a browser to <http://localhost:3000>.
2. **Step 1: Update Fan List** – fetch subscribers and followings and load them into the table.
3. **Step 2: Update Parker Names** – generate and apply Parker names for fans missing them.
4. Edit any names and click **Save** beside a fan to persist the change.
5. Type the message to broadcast. Use `{name}` or `[name]` as a placeholder or leave
   it out to have the greeting prefixed automatically.
6. Click **Send Personalised DM to All Fans** to start sending. Use **Abort Sending**
   to stop early.

## Follow Fans and Followers

Open <http://localhost:3000/follow.html> to follow back users who are not yet
subscribed. The page calls `GET /api/fans/unfollowed` to list accounts where
`isSubscribed` is `false`. Selecting **Follow All** issues a `POST
/api/fans/:id/follow` for each entry.

Requests are throttled with a 500 ms delay to respect OnlyFans rate limits. The
`ONLYFANS_API_KEY` environment variable must be set for the page to function.

## API

### Usage Sequence

1. **Step 1 – Update Fan List:** `POST /api/refreshFans` – sync subscribers and following users from OnlyFans.
2. **Step 2 – Update Parker Names:** `POST /api/updateParkerNames` – generate Parker names for fans missing them.
3. `GET /api/fans` – fetch the stored fan list with names.

### `POST /api/refreshFans`

Fetch OnlyFans subscribers and followings and upsert them into the database without
calling OpenAI. Returns `{ "fans": [...] }` with all stored fans.

#### Example response

```json
{ "fans": [{ "id": 1, "username": "demo_user", "parker_name": null }] }
```

### `POST /api/updateParkerNames`

Generate Parker names for any stored fans missing `parker_name`. Uses the configured OpenAI model and returns
`{ "fans": [...] }` after updating the database.

#### Example response

```json
{ "fans": [{ "id": 1, "username": "demo_user", "parker_name": "Spark" }] }
```

### `GET /api/fans`

Returns a JSON object with a `fans` array containing all fan records stored in the
database. Each fan includes:

- `id`, `username`, `name`, `parker_name`, `is_custom`
- Profile details: `avatar`, `header`, `website`, `location`, `gender`, `birthday`, `about`, `notes`
- Activity data: `lastSeen`, `joined`, `canReceiveChatMessage`, `canSendChatMessage`
- Status flags: `isBlocked`, `isMuted`, `isRestricted`, `isHidden`, `isBookmarked`, `isSubscribed`, `isFriend`, `renewedAd`
- Subscription info: `subscribedBy`, `subscribedOn`, `subscribedUntil`, `subscribedByData`, `subscribedOnData`, `promoOffers`
- Counts: `tipsSum`, `postsCount`, `photosCount`, `videosCount`, `audiosCount`, `mediaCount`, `subscribersCount`, `favoritesCount`
- Media fields: `avatarThumbs`, `headerSize`, `headerThumbs`, `listsStates`
- `updatedAt` timestamp of the last record update

#### Example response

```json
{
  "fans": [
    {
      "id": 1,
      "username": "demo_user",
      "name": "Demo",
      "parker_name": "Spark",
      "is_custom": false,
      "avatar": "https://cdn.example.com/avatar.jpg",
      "location": "USA",
      "isSubscribed": true,
      "tipsSum": 100,
      "avatarThumbs": { "150": "https://cdn.example.com/avatar_150.jpg" },
      "promoOffers": {},
      "updatedAt": "2025-08-05T00:00:00Z"
    }
  ]
}
```

JSONB columns such as `avatarThumbs`, `headerSize`, `headerThumbs`, `listsStates`,
`subscribedByData`, `subscribedOnData`, and `promoOffers` are returned as objects.

### Message Endpoints

- `POST /api/sendMessage` – Send a message to a fan. Supports HTML sanitisation,
  optional media IDs, and an optional `price` for pay‑per‑view style sends.
- `POST /api/scheduleMessage` – Queue a message to be delivered later.
- `GET /api/scheduledMessages` – List all pending scheduled messages.
- `PUT /api/scheduledMessages/:id` – Update a scheduled message.
- `DELETE /api/scheduledMessages/:id` – Cancel a scheduled message.
- `GET /api/messages/history` – Retrieve previously sent messages.

### Vault Media

- `GET /api/vault-media` – List stored vault media records.
- `POST /api/vault-media` – Upload files to the OnlyFans vault.
- `POST /api/vault-media/scrape` – Extract media IDs from a public URL.

### Vault Lists

- `GET /api/vault-lists` – List existing vault lists.
- `POST /api/vault-lists` – Create a new list.
- `GET /api/vault-lists/:id` – Fetch a list with its media IDs.
- `PUT /api/vault-lists/:id` – Rename a list.
- `DELETE /api/vault-lists/:id` – Remove a list.
- `POST /api/vault-lists/:id/media` – Add media IDs to a list.
- `DELETE /api/vault-lists/:id/media` – Remove media IDs from a list.

### Pay‑Per‑View (PPV)

- `GET /api/ppv` – List PPV message templates.
- `POST /api/ppv` – Create a new PPV entry.
- `PUT /api/ppv/:id` – Update a PPV entry.
- `POST /api/ppv/:id/send` – Send a PPV message to selected fans.
- `DELETE /api/ppv/:id` – Delete a PPV template.

## Webhooks

Listen to events from your OnlyFans accounts on your webhook endpoint so your integration can automatically process data.

> **Important** Webhooks are only available for Pro and Enterprise plans.

You can easily subscribe to webhooks using our console:

1. Go to the OnlyFansAPI Console -> Webhooks.
2. Click on the + Add Webhook button.
3. Fill in the Endpoint URL field with your webhook endpoint.
4. Optionally, add a Signing Secret to verify the webhook payloads (recommended).
5. Select the events you want to subscribe to.

### Available webhook events

A list of all available webhook events that you can subscribe to.

- **Accounts**
  - `accounts.connected` – A new OnlyFans account was connected.
  - `accounts.reconnected` – An OnlyFans account was reconnected.
  - `accounts.session_expired` – Connection expired but was automatically reconnected.
  - `accounts.authentication_failed` – Connection expired and couldn't be auto-reconnected.
  - `accounts.otp_code_required` – Two-factor authentication code required.
  - `accounts.face_otp_required` – Face verification required.
- **Messages**
  - `messages.received` – New message received from a fan.
  - `messages.sent` – Message sent from one of your accounts.
  - `messages.ppv.unlocked` – A PPV message you sent has been purchased.
- **Subscriptions**
  - `subscriptions.new` – A new fan has subscribed.
- **Posts**
  - `posts.liked` – A fan has liked one of your posts.
- **Users**
  - `users.typing` – A fan is typing a message.

See [Available webhook events](/webhooks/available-events) for example payloads and details on each event.

### Migration from single-endpoint workflow

Earlier versions used `/api/refreshFans` to also generate Parker names. Now call
`/api/refreshFans` and then `/api/updateParkerNames` to populate names.

## Testing

Run the unit tests with:

```bash
npm test
```

Jest is the configured test runner and includes suites such as
`__tests__/followFans.test.js`. Ensure all tests pass before committing.

## Notes

- All OnlyFans and OpenAI requests happen server‑side; API keys are never exposed in the
  browser.
- Message sending is rate‑limited (500 ms delay between fans) to reduce the chance of
  hitting OnlyFans rate limits.
- Message scheduling, vault management, and PPV features are still evolving and may
  change as the project develops.

<!-- End of File – Last modified 2025-02-15 -->
