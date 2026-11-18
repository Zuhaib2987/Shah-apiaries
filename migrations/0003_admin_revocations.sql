-- "Sign out everywhere" for an admin account.
-- A session token carries the time it was issued (iat). If that time is older than
-- the row here, the session is refused, so a lost phone can be cut off from any
-- other device without changing SESSION_SECRET and logging out everyone.
CREATE TABLE IF NOT EXISTS admin_revocations (
  user TEXT PRIMARY KEY,
  at   INTEGER NOT NULL
);
