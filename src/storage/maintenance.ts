export async function cleanup(db: D1Database): Promise<void> {
  const now = Date.now();
  await db.batch([
    db.prepare('DELETE FROM credentials WHERE expires_at IS NOT NULL AND expires_at<?').bind(now),
    db.prepare('DELETE FROM sync_locks WHERE expires_at<?').bind(now),
    db.prepare('DELETE FROM staging WHERE updated_at<?').bind(now - 86_400_000),
    db.prepare('DELETE FROM rate_limits WHERE bucket<?').bind(now - 86_400_000),
    db.prepare('DELETE FROM audit_logs WHERE created_at<?').bind(now - 30 * 86_400_000),
  ]);
}
const nextAttempt = new WeakMap<D1Database, number>();
export function scheduleMaintenance(db: D1Database, ctx: ExecutionContext): void {
  const now = Date.now();
  if ((nextAttempt.get(db) ?? 0) > now) return;
  nextAttempt.set(db, now + 3_600_000);
  ctx.waitUntil((async () => {
    const claim = await db.prepare(`INSERT INTO app_settings(key,value,created_at) VALUES('cleanup_at',?,?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE CAST(app_settings.value AS INTEGER)<? RETURNING key`)
      .bind(String(now), now, now - 86_400_000).first();
    if (claim) await cleanup(db);
  })().catch(() => { console.error(JSON.stringify({ event: 'maintenance_failed' })); }));
}
