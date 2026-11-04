import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const authorization = req.headers.get('Authorization') ?? '';
    const url = Deno.env.get('SUPABASE_URL')!;
    const publishable = JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_ANON_KEY')!;
    const secret = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}').default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const userClient = createClient(url, publishable, { global: { headers: { Authorization: authorization } } });
    const admin = createClient(url, secret);
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return Response.json({ error: 'Sign in first' }, { status: 401, headers: cors });
    const body = await req.json();
    const publicKey = Deno.env.get('VAPID_PUBLIC_KEY')!;
    if (body.action === 'public-key') return Response.json({ publicKey }, { headers: cors });
    const eventId = body.eventId as string;
    const { data: member } = await userClient.from('ryder_cup_members').select('event_id').eq('event_id', eventId).maybeSingle();
    if (!member) return Response.json({ error: 'Not a member' }, { status: 403, headers: cors });
    const [{ data: cup }, { data: matches }, { data: subscriptions }] = await Promise.all([
      admin.from('ryder_cups').select('*').eq('id', eventId).single(),
      admin.from('ryder_matchups').select('*').eq('event_id', eventId).order('sort_order'),
      admin.from('ryder_push_subscriptions').select('id,subscription').eq('event_id', eventId),
    ]);
    let a = 0, b = 0;
    const lines = (matches ?? []).filter((match) => match.hole_results.some((value: number | null) => value !== null)).map((match) => {
      const played = match.hole_results.filter((value: number | null) => value !== null);
      const lead = played.reduce((sum: number, value: number | null) => sum + (value ?? 0), 0);
      if (lead > 0) a += 1; else if (lead < 0) b += 1; else { a += .5; b += .5; }
      const label = lead === 0 ? 'AS' : `${Math.abs(lead)} UP ${lead > 0 ? match.team_a_players.join(' & ') : match.team_b_players.join(' & ')}`;
      return `${label} thru ${played.length}`;
    });
    webpush.setVapidDetails(Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com', publicKey, Deno.env.get('VAPID_PRIVATE_KEY')!);
    const payload = JSON.stringify({ title: `${cup.team_a_name} ${a} – ${b} ${cup.team_b_name}`, body: lines.slice(0, 3).join('\n') || 'Live scoring started', eventId, url: '/' });
    await Promise.allSettled((subscriptions ?? []).map(async (row) => {
      try { await webpush.sendNotification(row.subscription, payload); }
      catch (error) { if ((error as any).statusCode === 404 || (error as any).statusCode === 410) await admin.from('ryder_push_subscriptions').delete().eq('id', row.id); }
    }));
    return Response.json({ sent: subscriptions?.length ?? 0 }, { headers: cors });
  } catch (error) { return Response.json({ error: String(error) }, { status: 500, headers: cors }); }
});
