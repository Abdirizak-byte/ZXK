CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

CREATE TABLE clippers (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A client owns one or more YouTube channels / TikTok accounts.
CREATE TABLE clients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE youtube_channels (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  channel_id      TEXT NOT NULL UNIQUE,
  channel_title   TEXT,
  channel_handle  TEXT,
  thumbnail_url   TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clipper_youtube_channels (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clipper_id  UUID NOT NULL REFERENCES clippers(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clipper_id, channel_id)
);

CREATE TABLE shorts (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  channel_id           UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  video_id             TEXT NOT NULL UNIQUE,
  title                TEXT,
  thumbnail_url        TEXT,
  latest_views         BIGINT NOT NULL DEFAULT 0,
  published_at         TIMESTAMPTZ,
  last_checked_at      TIMESTAMPTZ,
  assigned_clipper_id  UUID REFERENCES clippers(id) ON DELETE SET NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE view_snapshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  short_id     UUID NOT NULL REFERENCES shorts(id) ON DELETE CASCADE,
  views        BIGINT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_snapshots_short_time ON view_snapshots(short_id, captured_at);

CREATE TABLE tiktok_accounts (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  client_id       UUID REFERENCES clients(id) ON DELETE SET NULL,
  account_id      TEXT NOT NULL UNIQUE,
  username        TEXT,
  display_name    TEXT,
  thumbnail_url   TEXT,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE clipper_tiktok_accounts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clipper_id  UUID NOT NULL REFERENCES clippers(id) ON DELETE CASCADE,
  account_id  UUID NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (clipper_id, account_id)
);

CREATE TABLE tiktok_videos (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id       UUID NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  video_id         TEXT NOT NULL UNIQUE,
  title            TEXT,
  thumbnail_url    TEXT,
  latest_views     BIGINT NOT NULL DEFAULT 0,
  published_at     TIMESTAMPTZ,
  last_checked_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tiktok_view_snapshots (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  video_id     UUID NOT NULL REFERENCES tiktok_videos(id) ON DELETE CASCADE,
  views        BIGINT NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_tiktok_snapshots_video_time ON tiktok_view_snapshots(video_id, captured_at);

CREATE TABLE payouts (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  clipper_id    UUID NOT NULL REFERENCES clippers(id) ON DELETE CASCADE,
  amount_cents  BIGINT NOT NULL,
  note          TEXT,
  paid_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Single-row table holding the global payout rate: rate_cents earned per rate_views views.
CREATE TABLE settings (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  rate_views  BIGINT NOT NULL DEFAULT 100000,
  rate_cents  BIGINT NOT NULL DEFAULT 500,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
INSERT INTO settings (rate_views, rate_cents) VALUES (100000, 500);

-- Dashboard logins. 'admin' sees and manages everything; 'client' is scoped to
-- one row in `clients` and can only view (never mutate) their own data.
CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'client' CHECK (role IN ('admin', 'client')),
  client_id      UUID REFERENCES clients(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Nightly auto-file job pre-computes these so the admin's Auto-File Clips page
-- loads instantly instead of waiting on live OpenAI calls. One row per
-- still-unreviewed short; deleted once the short gets assigned (by the nightly
-- apply flow or a manual assign), so COUNT(*) is the "needs review" badge.
CREATE TABLE autofile_suggestions (
  id                      UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  short_id                UUID NOT NULL UNIQUE REFERENCES shorts(id) ON DELETE CASCADE,
  channel_id              UUID NOT NULL REFERENCES youtube_channels(id) ON DELETE CASCADE,
  suggested_clipper_id    UUID REFERENCES clippers(id) ON DELETE SET NULL,
  suggested_clipper_name  TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_autofile_suggestions_channel ON autofile_suggestions(channel_id);

-- Public self-registration: a prospective clipper fills out /register.html
-- (no login required) and lands here as 'pending'. Approving creates the
-- real clippers row and attempts to auto-link the submitted handles.
CREATE TABLE clipper_applications (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name            TEXT NOT NULL,
  email           TEXT NOT NULL,
  youtube_handle  TEXT,
  tiktok_handle   TEXT,
  notes           TEXT,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  review_notes    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reviewed_at     TIMESTAMPTZ
);
CREATE INDEX idx_clipper_applications_status ON clipper_applications(status);
