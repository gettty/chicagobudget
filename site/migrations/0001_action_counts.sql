-- Optional first-party action counts. Bind a D1 database as ACTION_COUNTS only
-- after owner approval and explicit consent UI activation. Counts are not visitors.
-- Run periodic maintenance separately, not on each event, on both isolated DBs:
-- DELETE FROM action_counts WHERE day < date('now', '-90 days');
-- Schedule and verify this purge; inactive databases do not self-clean.
CREATE TABLE IF NOT EXISTS action_counts (
  day TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('budget_open', 'official_source_follow', 'dataset_download', 'permalink_share')),
  gov TEXT NOT NULL CHECK (gov IN ('city', 'cps', 'parks', 'none')),
  count INTEGER NOT NULL DEFAULT 0 CHECK (count >= 0),
  PRIMARY KEY (day, action, gov)
);
