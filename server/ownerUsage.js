// Read-only dashboard quota display. Never accepts a caller-selected tenant.
export function attachOwnerUsageRoute(app, db, now = () => new Date()) {
  app.get('/owner/ai-usage', async (req, res) => {
    try {
      if (!db) return res.status(503).json({ error: 'AI usage is unavailable.' });
      const token = /^Bearer (\S+)$/i.exec(req.headers.authorization || '')?.[1];
      if (!token) return res.status(401).json({ error: 'Sign in to view AI usage.' });
      const { data: auth, error: authError } = await db.auth.getUser(token);
      if (authError || !auth?.user?.id) return res.status(401).json({ error: 'Session expired.' });
      const businessId = auth.user.id;
      const profile = await db.from('profiles').select('id,plan').eq('id', businessId).maybeSingle();
      if (profile.error) throw profile.error;
      if (!profile.data) return res.status(403).json({ error: 'Only a business owner can view AI usage.' });
      const periodKey = profile.data.plan === '14-day trial' ? 'trial' : now().toISOString().slice(0, 7);
      const usage = await db.from('usage_periods').select('consumed,reserved')
        .eq('business_id', businessId).eq('period_key', periodKey).maybeSingle();
      if (usage.error) throw usage.error;
      return res.json({ periodKey, consumed: usage.data?.consumed ?? 0, reserved: usage.data?.reserved ?? 0 });
    } catch {
      return res.status(503).json({ error: 'Could not load current AI usage. Please retry.' });
    }
  });
}
