-- Add tier to channels and image_url to iq_tests
ALTER TABLE channels ADD COLUMN tier TEXT DEFAULT 'lite';
CREATE INDEX IF NOT EXISTS idx_channels_tier ON channels(tier);
