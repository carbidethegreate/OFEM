import express from "express";
import multer from "multer";
import axios from "axios";
import FormData from "form-data";
import fs from "fs";
import path from "path";
import morgan from "morgan";
import dotenv from "dotenv";

dotenv.config();

const app = express();
const upload = multer({ dest: "uploads/" });

const PORT = process.env.PORT || 3000;
const OF_API_KEY = process.env.OF_API_KEY;
const OF_ACCOUNT_ID = process.env.OF_ACCOUNT_ID;
const LIST_ID = process.env.LIST_ID || "26834941";

if (!OF_API_KEY || !OF_ACCOUNT_ID) {
  console.error("Missing OF_API_KEY or OF_ACCOUNT_ID");
  process.exit(1);
}

app.use(morgan("tiny"));
app.use(express.json());
app.use(express.static(path.join(process.cwd(), "public")));

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post("/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file uploaded" });
    }

    const displayName = req.body.name || req.file.originalname;
    const form = new FormData();

    form.append("file", fs.createReadStream(req.file.path), displayName);

    const url = `https://app.onlyfansapi.com/api/${OF_ACCOUNT_ID}/media/upload`;

    const ofResp = await axios.post(url, form, {
      headers: {
        Authorization: `Bearer ${OF_API_KEY}`,
        ...form.getHeaders()
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    fs.unlink(req.file.path, () => {});

    res.json({ success: true, data: ofResp.data });
  } catch (err) {
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.get("/vault/media", async (req, res) => {
  try {
    const { limit = 24, offset = 0, query } = req.query;
    const url = new URL(
      `https://app.onlyfansapi.com/api/${OF_ACCOUNT_ID}/media/vault`
    );

    url.searchParams.set("limit", limit);
    url.searchParams.set("offset", offset);
    if (query) url.searchParams.set("query", query);

    const ofResp = await axios.get(url.toString(), {
      headers: { Authorization: `Bearer ${OF_API_KEY}` }
    });

    res.json({ success: true, data: ofResp.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.post("/vault/lists/:listId?/media", async (req, res) => {
  try {
    const listId = req.params.listId || LIST_ID;
    const { mediaIds } = req.body;

    if (!Array.isArray(mediaIds) || mediaIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: "mediaIds array required"
      });
    }

    const url = `https://app.onlyfansapi.com/api/${OF_ACCOUNT_ID}/media/vault/lists/${listId}/media`;

    const ofResp = await axios.post(
      url,
      { mediaIds },
      { headers: { Authorization: `Bearer ${OF_API_KEY}` } }
    );

    res.json({ success: true, data: ofResp.data });
  } catch (err) {
    res.status(err.response?.status || 500).json({
      success: false,
      error: err.response?.data || err.message
    });
  }
});

app.listen(PORT, () => {
  console.log(`loadvault running on port ${PORT}`);
});
