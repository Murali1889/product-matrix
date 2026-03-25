-- Add billable_filter as JSONB to client_overrides
-- Structure: month as key, each value has codes, discount, kibana excludes, etc.
--
-- Example:
-- {
--   "default": {
--     "codes": ["200"],
--     "discount": 0,
--     "kibana_exclude": []
--   },
--   "Feb 2026": {
--     "codes": ["200", "400", "422"],
--     "discount": 15,
--     "kibana_exclude": ["internal_test", "staging_calls"]
--   }
-- }

ALTER TABLE client_overrides
ADD COLUMN IF NOT EXISTS billable_filter JSONB DEFAULT '{}';

COMMENT ON COLUMN client_overrides.billable_filter IS 'Per-month billing config. Keys = month ("default","Feb 2026"). Values = {codes, discount, kibana_exclude, ...}';
