-- Internal sync identities for account-password DAV. Existing tokens stay valid.
ALTER TABLE credentials ADD COLUMN auth_mode TEXT NOT NULL DEFAULT 'token' CHECK(auth_mode IN ('token','password'));
CREATE INDEX credentials_auth_mode ON credentials(user_id,auth_mode,expires_at);
