<!-- Modified 2025-08-05 – v1.0 -->

# OnlyFans Express Messenger (OFEM)

OFEM is a small dashboard that helps an OnlyFans creator greet fans by name and send a
personalised message to everyone in one pass.  It uses the official OnlyFans API to
fetch the fan list and send direct messages and OpenAI GPT‑4 to generate friendly
nicknames.

## Features

- **Update Fan List** – Fetches all subscribers and followings and stores them in the
  database without calling GPT.
- **Update Parker Names** – Generates a short “Parker name” with GPT‑4 only for fans who
  do not already have one. Names can be edited and saved.
- **Send Personalised DM** – Sends a message to every fan, greeting each with their
  Parker name.  Shows a green dot for success and red for failure.  Sending can be
  aborted and auto‑stops after ten consecutive errors.

## Prerequisites

- Node.js 22 LTS (v22.18.0)
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
   OpenAI API keys, database credentials, and admin credentials. This creates a `.env`
   file.

   Supplying database connection details and admin credentials now lets you reuse an
   existing PostgreSQL database and skip the `setup-db.command` step.

### Environment Variables

The server reads the following variables from your environment or `.env` file:

- `ONLYFANS_API_KEY` – authenticates requests to the OnlyFans API.
- `OPENAI_API_KEY` – enables OpenAI GPT‑4 for generating Parker names (required only
  for `/api/updateParkerNames`).
- `DB_NAME` – name of the PostgreSQL database to use.
- `DB_USER` – PostgreSQL username.
- `DB_PASSWORD` – password for the database user.
- `DB_HOST` – host address of the PostgreSQL server.
- `DB_PORT` – port number where PostgreSQL listens.
- `OF_FETCH_LIMIT` – optional cap on OnlyFans records fetched per sync (default 1000).

The `/api/status` endpoint reports whether each variable has been configured.

3. **Create the database**

   Run `./setup-db.command` (macOS) or `node setup-db.js` to spin up PostgreSQL via Docker
   (if needed), create a database with a random name, and write the credentials to your
   `.env` file. This step is unnecessary if you provided existing database credentials in
   the previous step. The script verifies required Node modules such as `pg` (used for
   JSONB operations) and `dotenv`, installing them automatically if missing.

   When upgrading an existing database, remember to run
   `node migrate_add_fan_fields.js` to add any new columns that may be required.

4. **Start the server**

   ```bash
   npm start
   ```

   The server listens on <http://localhost:3000> by default. To use a different port,
   set the `PORT` environment variable before starting, for example:

   ```bash
   PORT=8080 npm start
   ```

   You can also define `PORT` in your `.env` file. A convenience script
   `start.command` (macOS) installs npm packages if required and then launches the server.

## Fan Fields Migration and New Columns

Run the migration scripts below to ensure your database includes all of the latest fan
profile fields and the message-history schema.

```bash
node migrate_add_fan_fields.js
node migrate_messages.js
```

These scripts read connection details from your `.env` file. `migrate_add_fan_fields.js`
adds any missing columns to the `fans` table. The new columns and their purposes are:

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

Run `./addtodatabase.command` to apply both migrations to an existing database in one step.

## Usage

1. Open a browser to <http://localhost:3000>.
2. Click **Update Fan List** to load subscribers and followings into the table.
3. Click **Update Parker Names** to generate missing Parker names with GPT‑4.
4. Edit any names and click **Save** beside a fan to persist the change.
5. Type the message to broadcast.  Use `{name}` or `[name]` as a placeholder or leave
   it out to have the greeting prefixed automatically.
6. Click **Send Personalised DM to All Fans** to start sending.  Use **Abort Sending**
   to stop early.

## API

### Usage Sequence
1. `POST /api/refreshFans` – sync subscribers and following users from OnlyFans.
2. `POST /api/updateParkerNames` – generate Parker names for fans missing them.
3. `GET /api/fans` – fetch the stored fan list with names.

### `POST /api/refreshFans`

Fetch OnlyFans subscribers and followings and upsert them into the database without
calling GPT. Returns `{ "fans": [...] }` with all stored fans.

#### Example response

```json
{ "fans": [{ "id": 1, "username": "demo_user", "parker_name": null }] }
```

### `POST /api/updateParkerNames`

Generate Parker names for any stored fans missing `parker_name`. Uses GPT‑4 and returns
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

### Migration from single-endpoint workflow
Earlier versions used `/api/refreshFans` to also generate Parker names. Now call
`/api/refreshFans` and then `/api/updateParkerNames` to populate names.

## Testing

Run the unit tests with:

```bash
npm test
```

Jest is the configured test runner, so contributors should ensure all tests pass before committing.

## Notes

- All OnlyFans and OpenAI requests happen server‑side; API keys are never exposed in the
  browser.
- Message sending is rate‑limited (500 ms delay between fans) to reduce the chance of
  hitting OnlyFans rate limits.
- The project currently supports only the two features described above but is structured
  to allow further expansion.

<!-- End of File – Last modified 2025-08-05 -->
