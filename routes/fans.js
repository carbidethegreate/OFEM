const express = require("express");

module.exports = function ({
  getOFAccountId,
  ofApiRequest,
  ofApi,
  pool,
  sanitizeError,
  openaiAxios,
  openaiRequest,
  ensureValidParkerName,
  isSystemGenerated,
  removeEmojis,
  OPENAI_MODEL,
  OF_FETCH_LIMIT,
}) {
  const router = express.Router();

  router.post("/refreshFans", async (req, res) => {
    const missing = [];
    if (!process.env.ONLYFANS_API_KEY) missing.push("ONLYFANS_API_KEY");
    if (missing.length) {
      return res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(", ")}`,
      });
    }

    try {
      const accountId = await getOFAccountId(true);

      const validFilters = new Set(["all", "active", "expired"]);
      const rawFilter = (
        req.query.filter ||
        process.env.OF_FAN_FILTER ||
        "all"
      ).toLowerCase();
      const filter = validFilters.has(rawFilter) ? rawFilter : "all";

      const limit = 32;
      const fetchPaged = async (endpoint) => {
        const results = [];
        let offset = 0;
        let totalCount = null;
        while (true) {
          try {
            const resp = await ofApiRequest(() =>
              ofApi.get(endpoint, { params: { limit, offset } }),
            );
            const page = resp.data?.data?.list || resp.data?.list || resp.data;
            const count = resp.data?.data?.count ?? resp.data?.count;
            if (totalCount === null && Number.isFinite(count))
              totalCount = count;
            if (!page || page.length === 0) break;
            results.push(...page);
            offset += page.length;
            if (totalCount !== null && offset >= totalCount) break;
            if (offset >= OF_FETCH_LIMIT) {
              console.warn(
                `Fetch ${endpoint} reached configured limit ${OF_FETCH_LIMIT}, stopping.`,
              );
              break;
            }
          } catch (err) {
            const status = err.response?.status;
            if (status === 429) throw err;
            console.warn(
              `Fetch ${endpoint} failed at offset ${offset} (status ${status || "unknown"}). Returning partial results.`,
            );
            break;
          }
        }
        return results;
      };

      const fansList = await fetchPaged(`/${accountId}/fans/${filter}`);
      const followingList = await fetchPaged(
        `/${accountId}/following/${filter}`,
      );
      const fanMap = new Map();
      [...fansList, ...followingList].forEach((user) => {
        fanMap.set(user.id, user);
      });
      const allFans = Array.from(fanMap.values());
      console.log(
        `Fetched ${allFans.length} unique fans and followings from OnlyFans.`,
      );

      const dbRes = await pool.query(
        "SELECT id, parker_name, is_custom FROM fans",
      );
      const existingFans = {};
      for (const row of dbRes.rows) {
        existingFans[row.id] = {
          parker_name: row.parker_name,
          is_custom: row.is_custom,
        };
      }

      const processFan = async (fan) => {
        const fanId = fan.id.toString();
        const username = fan.username || "";
        const profileName = fan.name || "";
        const {
          avatar = null,
          header = null,
          website = null,
          location = null,
          gender = null,
          birthday = null,
          about = null,
          notes = null,
          lastSeen = null,
          joined = null,
          canReceiveChatMessage,
          canSendChatMessage,
          isBlocked,
          isMuted,
          isRestricted,
          isHidden,
          isBookmarked,
          isSubscribed,
          subscribedBy,
          subscribedOn,
          subscribedUntil,
          renewedAd,
          isFriend,
          tipsSum,
          postsCount,
          photosCount,
          videosCount,
          audiosCount,
          mediaCount,
          subscribersCount,
          favoritesCount,
          avatarThumbs,
          headerSize,
          headerThumbs,
          listsStates,
          subscribedByData,
          subscribedOnData,
          promoOffers,
        } = fan;

        const parseTimestamp = (value) => {
          if (value === null || value === undefined) return null;
          const date =
            typeof value === "number"
              ? new Date(value * 1000)
              : new Date(value);
          return isNaN(date.getTime()) ? null : date.toISOString();
        };

        const parseBoolean = (value) => {
          if (value === null || value === undefined) return null;
          return !!value;
        };

        const parseNumber = (value) => {
          if (value === null || value === undefined) return null;
          const num = Number(value);
          return Number.isNaN(num) ? null : num;
        };

        const lastSeenTs = parseTimestamp(lastSeen);
        const joinedTs = parseTimestamp(joined);
        const subscribedOnTs = parseTimestamp(subscribedOn);
        const subscribedUntilTs = parseTimestamp(subscribedUntil);

        const avatarThumbsJson = avatarThumbs
          ? JSON.stringify(avatarThumbs)
          : null;
        const headerSizeJson = headerSize ? JSON.stringify(headerSize) : null;
        const headerThumbsJson = headerThumbs
          ? JSON.stringify(headerThumbs)
          : null;
        const listsStatesJson = listsStates
          ? JSON.stringify(listsStates)
          : null;
        const subscribedByDataJson = subscribedByData
          ? JSON.stringify(subscribedByData)
          : null;
        const subscribedOnDataJson = subscribedOnData
          ? JSON.stringify(subscribedOnData)
          : null;
        const promoOffersJson = promoOffers
          ? JSON.stringify(promoOffers)
          : null;

        const tipsSumVal = parseNumber(tipsSum);
        const postsCountVal = parseNumber(postsCount);
        const photosCountVal = parseNumber(photosCount);
        const videosCountVal = parseNumber(videosCount);
        const audiosCountVal = parseNumber(audiosCount);
        const mediaCountVal = parseNumber(mediaCount);
        const subscribersCountVal = parseNumber(subscribersCount);
        const favoritesCountVal = parseNumber(favoritesCount);

        if (existingFans[fanId]) {
          await pool.query(
            `UPDATE fans SET
username=$2,
name=$3,
avatar=$4,
header=$5,
website=$6,
location=$7,
gender=$8,
birthday=$9,
about=$10,
notes=$11,
lastSeen=$12,
joined=$13,
canReceiveChatMessage=$14,
canSendChatMessage=$15,
isBlocked=$16,
isMuted=$17,
isRestricted=$18,
isHidden=$19,
isBookmarked=$20,
isSubscribed=$21,
subscribedBy=$22,
subscribedOn=$23,
subscribedUntil=$24,
renewedAd=$25,
isFriend=$26,
tipsSum=$27,
postsCount=$28,
photosCount=$29,
videosCount=$30,
audiosCount=$31,
mediaCount=$32,
subscribersCount=$33,
favoritesCount=$34,
avatarThumbs=$35,
headerSize=$36,
headerThumbs=$37,
listsStates=$38,
subscribedByData=$39,
subscribedOnData=$40,
promoOffers=$41,
updatedAt=NOW()
WHERE id=$1`,
            [
              fanId,
              username,
              profileName,
              avatar,
              header,
              website,
              location,
              gender,
              birthday,
              about,
              notes,
              lastSeenTs,
              joinedTs,
              parseBoolean(canReceiveChatMessage),
              parseBoolean(canSendChatMessage),
              parseBoolean(isBlocked),
              parseBoolean(isMuted),
              parseBoolean(isRestricted),
              parseBoolean(isHidden),
              parseBoolean(isBookmarked),
              parseBoolean(isSubscribed),
              subscribedBy,
              subscribedOnTs,
              subscribedUntilTs,
              parseBoolean(renewedAd),
              parseBoolean(isFriend),
              tipsSumVal,
              postsCountVal,
              photosCountVal,
              videosCountVal,
              audiosCountVal,
              mediaCountVal,
              subscribersCountVal,
              favoritesCountVal,
              avatarThumbsJson,
              headerSizeJson,
              headerThumbsJson,
              listsStatesJson,
              subscribedByDataJson,
              subscribedOnDataJson,
              promoOffersJson,
            ],
          );
        } else {
          await pool.query(
            `INSERT INTO fans (
id, username, name, avatar, header, website, location, gender, birthday, about,
notes,
lastSeen, joined, canReceiveChatMessage, canSendChatMessage, isBlocked, isMuted, isRestricted,
isHidden, isBookmarked, isSubscribed, subscribedBy, subscribedOn, subscribedUntil, renewedAd,
isFriend, tipsSum, postsCount, photosCount, videosCount, audiosCount, mediaCount,
subscribersCount, favoritesCount, avatarThumbs, headerSize, headerThumbs, listsStates,
subscribedByData, subscribedOnData, promoOffers, parker_name, is_custom
) VALUES (
$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,
$11,
$12,$13,$14,$15,$16,$17,$18,
$19,$20,$21,$22,$23,$24,$25,
$26,$27,$28,$29,$30,$31,$32,
$33,$34,$35,$36,$37,$38,$39,
$40,$41,$42,$43
)`,
            [
              fanId,
              username,
              profileName,
              avatar,
              header,
              website,
              location,
              gender,
              birthday,
              about,
              notes,
              lastSeenTs,
              joinedTs,
              parseBoolean(canReceiveChatMessage),
              parseBoolean(canSendChatMessage),
              parseBoolean(isBlocked),
              parseBoolean(isMuted),
              parseBoolean(isRestricted),
              parseBoolean(isHidden),
              parseBoolean(isBookmarked),
              parseBoolean(isSubscribed),
              subscribedBy,
              subscribedOnTs,
              subscribedUntilTs,
              parseBoolean(renewedAd),
              parseBoolean(isFriend),
              tipsSumVal,
              postsCountVal,
              photosCountVal,
              videosCountVal,
              audiosCountVal,
              mediaCountVal,
              subscribersCountVal,
              favoritesCountVal,
              avatarThumbsJson,
              headerSizeJson,
              headerThumbsJson,
              listsStatesJson,
              subscribedByDataJson,
              subscribedOnDataJson,
              promoOffersJson,
              existingFans[fanId]?.parker_name || null,
              existingFans[fanId]?.is_custom || false,
            ],
          );
        }
      };

      for (const fan of allFans) {
        await processFan(fan);
      }

      console.log("RefreshFans: Completed updating fan records.");
      const all = await pool.query("SELECT * FROM fans");
      res.json({ fans: all.rows });
    } catch (err) {
      console.error("Error in /api/refreshFans:", sanitizeError(err));
      const status =
        err.status ||
        (err.message && err.message.includes("No OnlyFans account")
          ? 400
          : 500);
      const message =
        status === 429
          ? "OnlyFans API rate limit exceeded. Please try again later."
          : err.message || "Failed to refresh fan list.";
      res.status(status).json({ error: message });
    }
  });

  let parkerUpdateInProgress = false;

  router.get("/updateParkerNames/status", (req, res) => {
    res.json({ inProgress: parkerUpdateInProgress });
  });

  router.post("/updateParkerNames", async (req, res) => {
    const missing = [];
    if (!process.env.OPENAI_API_KEY) missing.push("OPENAI_API_KEY");
    if (missing.length) {
      return res.status(400).json({
        error: `Missing environment variable(s): ${missing.join(", ")}`,
      });
    }

    if (parkerUpdateInProgress) {
      return res
        .status(409)
        .json({ error: "Parker name update already in progress." });
    }

    parkerUpdateInProgress = true;

    (async () => {
      try {
        const dbRes = await pool.query(
          "SELECT id, username, name, parker_name, is_custom FROM fans",
        );
        const toProcess = dbRes.rows.filter(
          (f) => (!f.parker_name || f.parker_name === "") && !f.is_custom,
        );

        const systemPrompt = `You are Parker’s conversational assistant. Decide how to address a subscriber by evaluating their username and profile name.

1. If the profile name contains a plausible real first name, use its first word.
2. Otherwise derive the name from the username: split camelCase or underscores, remove digits, and use the first resulting word.
3. Return "Cuddles" only when both the username and profile name look system generated (e.g. username is 'u' followed by digits or purely numeric and the profile name is blank or numeric).
4. Do not use abbreviations, initials, or ellipses. Provide a single fully spelled name with the first letter capitalized.

Respond with only the chosen name.`;

        const BATCH_SIZE = 5;
        const failedFanIds = [];

        const processFan = async (fan) => {
          const fanId = fan.id;
          const username = fan.username || "";
          const profileName = fan.name || "";

          try {
            let parkerName;
            if (isSystemGenerated(username, profileName)) {
              parkerName = "Cuddles";
            } else {
              const userPrompt = `Subscriber username: "${username}". Profile name: "${profileName}". What should be the display name?`;
              const completion = await openaiRequest(() =>
                openaiAxios.post(
                  "https://api.openai.com/v1/chat/completions",
                  {
                    model: OPENAI_MODEL,
                    messages: [
                      { role: "system", content: systemPrompt },
                      { role: "user", content: userPrompt },
                    ],
                    max_tokens: 10,
                    temperature: 0.3,
                  },
                  {
                    headers: {
                      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
                    },
                  },
                ),
              );
              parkerName = completion.data.choices[0].message.content.trim();
              console.log(
                `${OPENAI_MODEL} name for ${username}: ${parkerName}`,
              );
            }

            const originalName = parkerName;
            parkerName = ensureValidParkerName(
              parkerName,
              username,
              profileName,
            );
            if (parkerName !== originalName) {
              // Parker name was adjusted to meet validation rules
            }

            await pool.query(
              "UPDATE fans SET parker_name=$2, is_custom=false, updatedAt=NOW() WHERE id=$1",
              [fanId, parkerName],
            );
          } catch (err) {
            console.error(
              `Failed to process fan ${fanId}:`,
              sanitizeError(err),
            );
            failedFanIds.push(fanId);
          }
        };

        for (let i = 0; i < toProcess.length; i += BATCH_SIZE) {
          const batch = toProcess.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(processFan));
        }

        if (failedFanIds.length > 0) {
          console.log(
            "Failed to update Parker names for fan IDs:",
            failedFanIds,
          );
        }
      } catch (err) {
        console.error("Error in /api/updateParkerNames:", sanitizeError(err));
      } finally {
        parkerUpdateInProgress = false;
      }
    })();

    res.json({ started: true });
  });

  router.put("/fans/:id", async (req, res) => {
    try {
      const fanId = req.params.id;
      const rawName = req.body.parker_name;
      if (!fanId || !rawName) {
        return res.status(400).json({ error: "Missing fan id or name." });
      }
      const sanitized = removeEmojis(rawName).trim();
      const checked = ensureValidParkerName(sanitized, "", "");
      if (checked !== sanitized) {
        return res.status(400).json({ error: "Invalid Parker name." });
      }
      await pool.query(
        "UPDATE fans SET parker_name=$1, is_custom=$2 WHERE id=$3",
        [checked, true, fanId],
      );
      console.log(
        `User manually set ParkerName for fan ${fanId} -> "${checked}"`,
      );
      res.json({ success: true });
    } catch (err) {
      console.error("Error in /api/fans/:id PUT:", sanitizeError(err));
      res.status(500).json({ error: "Failed to update name." });
    }
  });

  router.get("/fans", async (req, res) => {
    try {
      const dbRes = await pool.query(`
SELECT
id,
username,
name,
avatar,
header,
website,
location,
gender,
birthday,
about,
notes,
lastSeen AS "lastSeen",
joined AS "joined",
canReceiveChatMessage AS "canReceiveChatMessage",
canSendChatMessage AS "canSendChatMessage",
isBlocked AS "isBlocked",
isMuted AS "isMuted",
isRestricted AS "isRestricted",
isHidden AS "isHidden",
isBookmarked AS "isBookmarked",
isSubscribed AS "isSubscribed",
subscribedBy AS "subscribedBy",
subscribedOn AS "subscribedOn",
subscribedUntil AS "subscribedUntil",
renewedAd AS "renewedAd",
isFriend AS "isFriend",
tipsSum AS "tipsSum",
postsCount AS "postsCount",
photosCount AS "photosCount",
videosCount AS "videosCount",
audiosCount AS "audiosCount",
mediaCount AS "mediaCount",
subscribersCount AS "subscribersCount",
favoritesCount AS "favoritesCount",
avatarThumbs AS "avatarThumbs",
headerSize AS "headerSize",
headerThumbs AS "headerThumbs",
listsStates AS "listsStates",
subscribedByData AS "subscribedByData",
subscribedOnData AS "subscribedOnData",
promoOffers AS "promoOffers",
parker_name,
is_custom,
updatedAt AS "updatedAt"
FROM fans
ORDER BY id`);
      res.json({ fans: dbRes.rows });
    } catch (err) {
      console.error("Error in GET /api/fans:", sanitizeError(err));
      res.status(500).json({ error: "Failed to retrieve fans." });
    }
  });

  router.get("/fans/unfollowed", async (req, res) => {
    try {
      const dbRes = await pool.query(
        "SELECT id, username FROM fans WHERE isSubscribed = FALSE ORDER BY id",
      );
      res.json({ fans: dbRes.rows });
    } catch (err) {
      console.error("Error in GET /api/fans/unfollowed:", sanitizeError(err));
      res.status(500).json({ error: "Failed to retrieve unfollowed fans." });
    }
  });

  router.post("/fans/:id/follow", async (req, res) => {
    try {
      const fanId = req.params.id;
      if (!fanId) return res.status(400).json({ error: "Missing fan id." });
      let accountId;
      try {
        accountId = await getOFAccountId();
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      await ofApiRequest(() =>
        ofApi.post(`/${accountId}/users/${fanId}/follow`),
      );
      await pool.query("UPDATE fans SET isSubscribed = TRUE WHERE id=$1", [
        fanId,
      ]);
      res.json({ success: true });
    } catch (err) {
      console.error("Error in POST /api/fans/:id/follow:", sanitizeError(err));
      const status = err.status || err.response?.status;
      const message =
        status === 429
          ? "OnlyFans API rate limit exceeded. Please try again later."
          : err.response
            ? err.response.statusText || err.response.data
            : err.message;
      res.status(status || 500).json({ error: message });
    }
  });

  router.post("/fans/followAll", async (req, res) => {
    let accountId;
    try {
      accountId = await getOFAccountId();
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    let fans;
    try {
      const dbRes = await pool.query(
        "SELECT id, username FROM fans WHERE isSubscribed = FALSE ORDER BY id",
      );
      fans = dbRes.rows;
    } catch (err) {
      console.error("Error in POST /api/fans/followAll:", sanitizeError(err));
      return res.status(500).json({ error: "Failed to fetch fans." });
    }

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    if (res.flushHeaders) res.flushHeaders();

    for (const fan of fans) {
      try {
        await ofApiRequest(() =>
          ofApi.post(`/${accountId}/users/${fan.id}/follow`),
        );
        await pool.query("UPDATE fans SET isSubscribed = TRUE WHERE id=$1", [
          fan.id,
        ]);
        res.write(
          `data: ${JSON.stringify({ id: fan.id, username: fan.username, success: true })}\n\n`,
        );
      } catch (err) {
        const msg = err.response
          ? err.response.statusText || err.response.data
          : err.message;
        res.write(
          `data: ${JSON.stringify({ id: fan.id, username: fan.username, success: false, error: msg })}\n\n`,
        );
      }
    }
    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  });

  return router;
};
