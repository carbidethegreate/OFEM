-- Ensure a vault_media table exists for caching. Run via your migration tool.

CREATE TABLE IF NOT EXISTS vault_media (
  id BIGINT PRIMARY KEY,
  thumb_url TEXT,
  preview_url TEXT,
  likes INT,
  tips INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
