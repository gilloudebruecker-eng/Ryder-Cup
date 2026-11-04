import type { Session } from "@supabase/supabase-js";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { supabase } from "./supabase";

type Cup = {
  id: string;
  name: string;
  join_code: string;
  team_a_name: string;
  team_b_name: string;
  team_size: number;
};
type MatchFormat = "scramble" | "stableford";
type Matchup = {
  id: string;
  event_id: string;
  sort_order: number;
  format: MatchFormat;
  team_a_players: string[];
  team_b_players: string[];
  hole_results: Array<number | null>;
};
type Props = {
  session: Session | null;
  onClose: () => void;
  onSignIn: () => void;
};

const code = () => Math.random().toString(36).slice(2, 8).toUpperCase();
const blankResults = () => Array<number | null>(18).fill(null);
const vapidBytes = (value: string) => {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from([...raw].map((character) => character.charCodeAt(0)));
};
const matchStatus = (match: Matchup) => {
  const played = match.hole_results.filter((value) => value !== null);
  const lead = played.reduce((sum, value) => sum + (value ?? 0), 0);
  const thru = played.length;
  const remaining = 18 - thru;
  const closed = thru === 18 || Math.abs(lead) > remaining;
  const leader: "a" | "b" | "tie" = lead > 0 ? "a" : lead < 0 ? "b" : "tie";
  const winner =
    leader === "a"
      ? match.team_a_players.join(" & ")
      : match.team_b_players.join(" & ");
  const result =
    remaining > 0 ? `${Math.abs(lead)} & ${remaining}` : `${Math.abs(lead)} UP`;
  const label = closed
    ? leader === "tie"
      ? "MATCH HALVED"
      : `${winner} WINS ${result}`
    : leader === "tie"
      ? "ALL SQUARE"
      : `${winner} ${Math.abs(lead)} UP${Math.abs(lead) === remaining ? " · DORMIE" : ""}`;
  return { thru, remaining, lead, leader, closed, label };
};

export default function RyderCup({ session, onClose, onSignIn }: Props) {
  const [cups, setCups] = useState<Cup[]>([]);
  const [activeCup, setActiveCup] = useState<Cup | null>(null);
  const [matchups, setMatchups] = useState<Matchup[]>([]);
  const [selected, setSelected] = useState<Matchup | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(Boolean(session));
  const [joinCode, setJoinCode] = useState("");
  const [message, setMessage] = useState("");

  async function loadCups(openId?: string) {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("ryder_cups")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) setMessage(error.message);
    const next = (data ?? []) as Cup[];
    setCups(next);
    if (openId) setActiveCup(next.find((cup) => cup.id === openId) ?? null);
    setLoading(false);
  }

  async function loadMatchups(cupId: string) {
    if (!supabase) return;
    const { data, error } = await supabase
      .from("ryder_matchups")
      .select("*")
      .eq("event_id", cupId)
      .order("sort_order");
    if (error) setMessage(error.message);
    else setMatchups((data ?? []) as Matchup[]);
  }

  useEffect(() => {
    loadCups();
  }, [session?.user.id]);
  useEffect(() => {
    if (!activeCup || !supabase) return;
    const client = supabase;
    loadMatchups(activeCup.id);
    const channel = client
      .channel(`ryder-${activeCup.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "ryder_matchups",
          filter: `event_id=eq.${activeCup.id}`,
        },
        () => loadMatchups(activeCup.id),
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [activeCup?.id]);
  useEffect(() => {
    if (!selected) return;
    const fresh = matchups.find((match) => match.id === selected.id);
    if (fresh) setSelected(fresh);
  }, [matchups]);

  async function join() {
    if (!supabase || !joinCode.trim()) return;
    setMessage("");
    const { data, error } = await supabase.rpc("join_ryder_cup", {
      invite_code: joinCode.trim().toUpperCase(),
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    await loadCups(data as string);
  }

  async function updateHole(
    match: Matchup,
    hole: number,
    result: number | null,
  ) {
    if (!supabase) return;
    const results = [...match.hole_results];
    results[hole] = result;
    setMatchups((current) =>
      current.map((item) =>
        item.id === match.id ? { ...item, hole_results: results } : item,
      ),
    );
    setSelected({ ...match, hole_results: results });
    const { error } = await supabase
      .from("ryder_matchups")
      .update({ hole_results: results, updated_at: new Date().toISOString() })
      .eq("id", match.id);
    if (error) {
      setMessage(error.message);
      await loadMatchups(match.event_id);
    } else
      supabase.functions
        .invoke("ryder-push", {
          body: { action: "score-update", eventId: match.event_id },
        })
        .catch(() => undefined);
  }

  if (!session)
    return (
      <SafeAreaView style={s.safe}>
        <View style={s.center}>
          <Pressable onPress={onClose}>
            <Text style={s.back}>‹ Back</Text>
          </Pressable>
          <Text style={s.kicker}>RYDER CUP LIVE</Text>
          <Text style={s.hero}>Sign in to join the team</Text>
          <Text style={s.body}>
            Every participant uses an email magic link. This keeps the private
            live scoreboard available on every phone.
          </Text>
          <Pressable onPress={onSignIn} style={s.primary}>
            <Text style={s.primaryText}>Sign in with email</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  if (creating)
    return (
      <CreateCup
        onCancel={() => setCreating(false)}
        onCreated={async (id) => {
          setCreating(false);
          await loadCups(id);
        }}
      />
    );
  if (selected && activeCup)
    return (
      <MatchDetail
        cup={activeCup}
        match={selected}
        onBack={() => setSelected(null)}
        onHole={updateHole}
      />
    );
  if (activeCup)
    return (
      <Dashboard
        cup={activeCup}
        matchups={matchups}
        onBack={() => {
          setActiveCup(null);
          setMatchups([]);
        }}
        onOpen={setSelected}
      />
    );

  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page}>
        <Pressable onPress={onClose}>
          <Text style={s.back}>‹ Back to golf</Text>
        </Pressable>
        <Text style={s.kicker}>GPS-FREE LIVE SCORING</Text>
        <Text style={s.hero}>Ryder Cup</Text>
        <Text style={s.body}>
          Create teams and matchups, or enter a six-character code to join a
          live cup.
        </Text>
        <View style={s.joinRow}>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            maxLength={6}
            placeholder="JOIN CODE"
            placeholderTextColor="#66786c"
            style={s.codeInput}
          />
          <Pressable onPress={join} style={s.joinButton}>
            <Text style={s.primaryText}>Join</Text>
          </Pressable>
        </View>
        <Pressable onPress={() => setCreating(true)} style={s.primary}>
          <Text style={s.primaryText}>Create a Ryder Cup</Text>
        </Pressable>
        <Text style={s.section}>MY LIVE CUPS</Text>
        {loading ? (
          <ActivityIndicator color="#d8ff70" />
        ) : cups.length ? (
          cups.map((cup) => (
            <Pressable
              key={cup.id}
              onPress={() => setActiveCup(cup)}
              style={s.card}
            >
              <View>
                <Text style={s.cardTitle}>{cup.name}</Text>
                <Text style={s.muted}>
                  {cup.team_a_name} vs {cup.team_b_name} · {cup.team_size}v
                  {cup.team_size}
                </Text>
              </View>
              <Text style={s.code}>{cup.join_code}</Text>
            </Pressable>
          ))
        ) : (
          <Text style={s.muted}>No Ryder Cups yet.</Text>
        )}
        {message ? <Text style={s.error}>{message}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function CreateCup({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (id: string) => void;
}) {
  const [name, setName] = useState("Ryder Cup");
  const [teamA, setTeamA] = useState("Team Europe");
  const [teamB, setTeamB] = useState("Team USA");
  const [size, setSize] = useState(5);
  const [aPlayers, setAPlayers] = useState(
    Array.from({ length: 5 }, (_, i) => `Player A${i + 1}`),
  );
  const [bPlayers, setBPlayers] = useState(
    Array.from({ length: 5 }, (_, i) => `Player B${i + 1}`),
  );
  const [pairs, setPairs] = useState(2);
  const [formats, setFormats] = useState<MatchFormat[]>([
    "scramble",
    "scramble",
    "stableford",
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const singles = size - pairs * 2;
  const matchupCount = pairs + singles;

  function resize(next: number) {
    const n = Math.max(1, Math.min(12, next));
    setSize(n);
    setAPlayers(
      Array.from({ length: n }, (_, i) => aPlayers[i] ?? `Player A${i + 1}`),
    );
    setBPlayers(
      Array.from({ length: n }, (_, i) => bPlayers[i] ?? `Player B${i + 1}`),
    );
    setPairs(Math.min(Math.floor(n / 2), pairs));
  }
  function choosePairs(next: number) {
    setPairs(next);
    const count = next + size - next * 2;
    setFormats(
      Array.from({ length: count }, (_, i) =>
        i < next ? "scramble" : "stableford",
      ),
    );
  }
  function setPlayer(team: "a" | "b", index: number, value: string) {
    const source = team === "a" ? aPlayers : bPlayers;
    const next = [...source];
    next[index] = value;
    team === "a" ? setAPlayers(next) : setBPlayers(next);
  }
  async function create() {
    if (!supabase) return;
    if (
      !name.trim() ||
      [...aPlayers, ...bPlayers].some((player) => !player.trim())
    ) {
      setError("Enter every player name.");
      return;
    }
    setSaving(true);
    setError("");
    const joinCode = code();
    const { data: cupId, error: cupError } = await supabase.rpc(
      "create_ryder_cup",
      {
        cup_name: name.trim(),
        invite_code: joinCode,
        first_team_name: teamA.trim() || "Team A",
        second_team_name: teamB.trim() || "Team B",
        players_per_team: size,
      },
    );
    if (cupError) {
      setError(cupError.message);
      setSaving(false);
      return;
    }
    const rows: any[] = [];
    let playerIndex = 0;
    for (let i = 0; i < pairs; i++) {
      rows.push({
        event_id: cupId,
        sort_order: rows.length,
        format: formats[rows.length],
        team_a_players: aPlayers.slice(playerIndex, playerIndex + 2),
        team_b_players: bPlayers.slice(playerIndex, playerIndex + 2),
        hole_results: blankResults(),
      });
      playerIndex += 2;
    }
    for (let i = 0; i < singles; i++) {
      rows.push({
        event_id: cupId,
        sort_order: rows.length,
        format: formats[rows.length],
        team_a_players: [aPlayers[playerIndex]],
        team_b_players: [bPlayers[playerIndex]],
        hole_results: blankResults(),
      });
      playerIndex++;
    }
    const { error: matchError } = await supabase
      .from("ryder_matchups")
      .insert(rows);
    if (matchError) {
      setError(matchError.message);
      setSaving(false);
      return;
    }
    onCreated(cupId as string);
  }
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView
        contentContainerStyle={s.page}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={onCancel}>
          <Text style={s.back}>‹ Cancel</Text>
        </Pressable>
        <Text style={s.kicker}>NEW LIVE EVENT</Text>
        <Text style={s.hero}>Build the teams</Text>
        <Text style={s.label}>EVENT NAME</Text>
        <TextInput value={name} onChangeText={setName} style={s.input} />
        <Text style={s.label}>PLAYERS PER TEAM</Text>
        <View style={s.stepper}>
          <Pressable onPress={() => resize(size - 1)} style={s.step}>
            <Text style={s.stepText}>−</Text>
          </Pressable>
          <Text style={s.size}>
            {size} vs {size}
          </Text>
          <Pressable onPress={() => resize(size + 1)} style={s.step}>
            <Text style={s.stepText}>+</Text>
          </Pressable>
        </View>
        <View style={s.teamColumns}>
          <View style={s.team}>
            <TextInput
              value={teamA}
              onChangeText={setTeamA}
              style={s.teamName}
            />
            {aPlayers.map((p, i) => (
              <TextInput
                key={i}
                value={p}
                onChangeText={(v) => setPlayer("a", i, v)}
                style={s.playerInput}
              />
            ))}
          </View>
          <View style={s.team}>
            <TextInput
              value={teamB}
              onChangeText={setTeamB}
              style={s.teamName}
            />
            {bPlayers.map((p, i) => (
              <TextInput
                key={i}
                value={p}
                onChangeText={(v) => setPlayer("b", i, v)}
                style={s.playerInput}
              />
            ))}
          </View>
        </View>
        <Text style={s.label}>MATCHUP PLAN</Text>
        {Array.from({ length: Math.floor(size / 2) + 1 }, (_, p) => (
          <Pressable
            key={p}
            onPress={() => choosePairs(p)}
            style={[s.option, pairs === p && s.optionOn]}
          >
            <Text style={s.optionText}>
              {p ? `${p} × 2v2` : ""}
              {p && size - p * 2 ? " + " : ""}
              {size - p * 2 ? `${size - p * 2} × 1v1` : ""}
            </Text>
          </Pressable>
        ))}
        <Text style={s.label}>FORMAT PER MATCHUP</Text>
        {Array.from({ length: matchupCount }, (_, i) => (
          <View key={i} style={s.formatLine}>
            <Text style={s.muted}>
              Match {i + 1} · {i < pairs ? "2v2" : "1v1"}
            </Text>
            <View style={s.formatButtons}>
              {(["scramble", "stableford"] as MatchFormat[]).map((f) => (
                <Pressable
                  key={f}
                  onPress={() =>
                    setFormats((current) =>
                      current.map((x, j) => (j === i ? f : x)),
                    )
                  }
                  style={[s.mini, formats[i] === f && s.optionOn]}
                >
                  <Text style={s.miniText}>
                    {f === "scramble" ? "Scramble" : "Stableford"}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
        {error ? <Text style={s.error}>{error}</Text> : null}
        <Pressable disabled={saving} onPress={create} style={s.primary}>
          <Text style={s.primaryText}>
            {saving ? "Creating..." : "Create live scoreboard"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Dashboard({
  cup,
  matchups,
  onBack,
  onOpen,
}: {
  cup: Cup;
  matchups: Matchup[];
  onBack: () => void;
  onOpen: (m: Matchup) => void;
}) {
  const [pushMessage, setPushMessage] = useState("");
  async function enablePush() {
    try {
      if (!supabase || !("serviceWorker" in navigator))
        throw new Error(
          "This browser does not support background notifications.",
        );
      if (!window.isSecureContext)
        throw new Error(
          "Lock-screen updates require a secure HTTPS connection.",
        );
      const isAppleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
      const isStandalone =
        window.matchMedia("(display-mode: standalone)").matches ||
        Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
      if (isAppleMobile && !isStandalone)
        throw new Error(
          "On iPhone: open this site in Safari, choose Share > Add to Home Screen, then open the installed app.",
        );
      if (!("Notification" in window))
        throw new Error("Notifications are unavailable in this browser.");
      const permission = await Notification.requestPermission();
      if (permission !== "granted")
        throw new Error(
          "Notification permission is off. Enable it in your phone's notification settings.",
        );
      const registration = await navigator.serviceWorker.ready;
      if (!registration.pushManager)
        throw new Error(
          "Web Push is unavailable. Update iOS/Android and open the installed home-screen app.",
        );
      const { data, error } = await supabase.functions.invoke("ryder-push", {
        body: { action: "public-key" },
      });
      if (error || !data?.publicKey)
        throw new Error("Push service is not configured yet.");
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: vapidBytes(data.publicKey),
      });
      const json = subscription.toJSON();
      const { error: saveError } = await supabase
        .from("ryder_push_subscriptions")
        .upsert(
          {
            event_id: cup.id,
            endpoint: subscription.endpoint,
            subscription: json,
          },
          { onConflict: "event_id,endpoint" },
        );
      if (saveError) throw saveError;
      setPushMessage("Lock-screen updates enabled on this phone.");
    } catch (error) {
      setPushMessage(
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
      );
    }
  }
  const { actualPoints, projectedPoints } = useMemo(
    () =>
      matchups.reduce(
        (totals, match) => {
          const status = matchStatus(match);
          const award =
            status.leader === "a"
              ? ([1, 0] as const)
              : status.leader === "b"
                ? ([0, 1] as const)
                : ([0.5, 0.5] as const);
          totals.projectedPoints[0] += award[0];
          totals.projectedPoints[1] += award[1];
          if (status.closed) {
            totals.actualPoints[0] += award[0];
            totals.actualPoints[1] += award[1];
          }
          return totals;
        },
        {
          actualPoints: [0, 0] as [number, number],
          projectedPoints: [0, 0] as [number, number],
        },
      ),
    [matchups],
  );
  const projectedLeader =
    projectedPoints[0] === projectedPoints[1]
      ? "Projected tie"
      : `${projectedPoints[0] > projectedPoints[1] ? cup.team_a_name : cup.team_b_name} projected ahead`;
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page}>
        <Pressable onPress={onBack}>
          <Text style={s.back}>‹ My Ryder Cups</Text>
        </Pressable>
        <Text style={s.kicker}>LIVE · CODE {cup.join_code}</Text>
        <Text style={s.hero}>{cup.name}</Text>
        <Text style={s.standingLabel}>
          CURRENT STANDINGS · COMPLETED MATCHES
        </Text>
        <View style={s.overall}>
          <View>
            <Text style={s.teamBig}>{cup.team_a_name}</Text>
            <Text style={s.points}>{actualPoints[0]}</Text>
          </View>
          <Text style={s.versus}>—</Text>
          <View>
            <Text style={s.teamBig}>{cup.team_b_name}</Text>
            <Text style={s.points}>{actualPoints[1]}</Text>
          </View>
        </View>
        <Text style={s.standingHelp}>
          Only matches that are final or mathematically closed count here.
        </Text>
        <Text style={s.standingLabel}>
          PROJECTED STANDINGS · IF PLAY STOPPED NOW
        </Text>
        <View style={[s.overall, s.projectedOverall]}>
          <View>
            <Text style={s.teamBig}>{cup.team_a_name}</Text>
            <Text style={s.projectedPoints}>{projectedPoints[0]}</Text>
          </View>
          <Text style={s.versus}>—</Text>
          <View>
            <Text style={s.teamBig}>{cup.team_b_name}</Text>
            <Text style={s.projectedPoints}>{projectedPoints[1]}</Text>
          </View>
        </View>
        <Text style={s.projected}>
          {projectedLeader.toUpperCase()} · ACTIVE LEADS COUNT · NOT STARTED =
          ½–½
        </Text>
        <Pressable onPress={enablePush} style={s.pushButton}>
          <Text style={s.pushTitle}>Enable lock-screen updates</Text>
          <Text style={s.pushText}>
            Receive every score change on iPhone or Samsung
          </Text>
        </Pressable>
        {pushMessage ? <Text style={s.pushMessage}>{pushMessage}</Text> : null}
        <Text style={s.section}>CURRENT MATCHUPS</Text>
        {matchups.map((match) => {
          const status = matchStatus(match);
          return (
            <Pressable
              key={match.id}
              onPress={() => onOpen(match)}
              style={[s.match, status.closed && s.matchClosed]}
            >
              <View style={s.matchTeams}>
                <Text
                  style={[s.matchPlayers, status.leader === "a" && s.leading]}
                >
                  {match.team_a_players.join(" & ")}
                </Text>
                <Text style={s.vs}>vs</Text>
                <Text
                  style={[s.matchPlayers, status.leader === "b" && s.leading]}
                >
                  {match.team_b_players.join(" & ")}
                </Text>
              </View>
              <View style={s.status}>
                <Text style={s.statusText}>{status.label}</Text>
                <Text style={s.thru}>
                  {status.closed
                    ? "FINAL"
                    : status.thru
                      ? `THRU ${status.thru}`
                      : "NOT STARTED"}{" "}
                  · {match.format.toUpperCase()}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function MatchDetail({
  cup,
  match,
  onBack,
  onHole,
}: {
  cup: Cup;
  match: Matchup;
  onBack: () => void;
  onHole: (m: Matchup, h: number, r: number | null) => void;
}) {
  const status = matchStatus(match);
  return (
    <SafeAreaView style={s.safe}>
      <ScrollView contentContainerStyle={s.page}>
        <Pressable onPress={onBack}>
          <Text style={s.back}>‹ Live scoreboard</Text>
        </Pressable>
        <Text style={s.kicker}>{match.format.toUpperCase()} · MATCH PLAY</Text>
        <Text style={s.hero}>{status.label}</Text>
        <Text style={s.body}>
          {match.team_a_players.join(" & ")} vs{" "}
          {match.team_b_players.join(" & ")}
        </Text>
        {status.closed && (
          <View style={s.complete}>
            <Text style={s.completeText}>MATCH COMPLETE</Text>
            <Text style={s.completeSub}>
              Remaining holes are closed. Clear an earlier result to make a
              correction.
            </Text>
          </View>
        )}
        {match.hole_results.map((result, h) => {
          const locked = status.closed && result === null;
          return (
            <View key={h} style={[s.hole, locked && s.locked]}>
              <Text style={s.holeNumber}>{h + 1}</Text>
              <Pressable
                disabled={locked}
                onPress={() => onHole(match, h, 1)}
                style={[s.result, result === 1 && s.resultOn]}
              >
                <Text style={s.resultText}>{cup.team_a_name}</Text>
              </Pressable>
              <Pressable
                disabled={locked}
                onPress={() => onHole(match, h, 0)}
                style={[s.result, result === 0 && s.resultOn]}
              >
                <Text style={s.resultText}>Halved</Text>
              </Pressable>
              <Pressable
                disabled={locked}
                onPress={() => onHole(match, h, -1)}
                style={[s.result, result === -1 && s.resultOn]}
              >
                <Text style={s.resultText}>{cup.team_b_name}</Text>
              </Pressable>
              {result !== null && (
                <Pressable onPress={() => onHole(match, h, null)}>
                  <Text style={s.clear}>×</Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const liveStyles = {
  projected: {
    color: "#88a08f",
    fontSize: 9,
    fontWeight: "900" as const,
    textAlign: "center" as const,
    letterSpacing: 1,
    marginTop: 8,
  },
  standingLabel: {
    color: "#a8b9ad",
    fontSize: 9,
    fontWeight: "900" as const,
    letterSpacing: 1.1,
    marginTop: 20,
    marginBottom: -10,
  },
  standingHelp: {
    color: "#718578",
    fontSize: 9,
    lineHeight: 14,
    textAlign: "center" as const,
    marginTop: 7,
  },
  projectedOverall: {
    borderWidth: 1,
    borderColor: "#d8ff70",
    backgroundColor: "#193622",
  },
  projectedPoints: {
    color: "#d8ff70",
    fontSize: 38,
    fontWeight: "900" as const,
    textAlign: "center" as const,
  },
  matchTeams: { gap: 2 },
  leading: { color: "#d8ff70" },
  matchClosed: { borderWidth: 1, borderColor: "#4f6c57" },
  complete: {
    backgroundColor: "#d8ff70",
    borderRadius: 13,
    padding: 13,
    marginBottom: 14,
  },
  completeText: {
    color: "#102015",
    fontWeight: "900" as const,
    textAlign: "center" as const,
  },
  completeSub: {
    color: "#385128",
    fontSize: 9,
    textAlign: "center" as const,
    marginTop: 3,
  },
  locked: { opacity: 0.28 },
  pushButton: {
    borderWidth: 1,
    borderColor: "#d8ff70",
    borderRadius: 14,
    padding: 13,
    marginTop: 15,
    alignItems: "center" as const,
  },
  pushTitle: { color: "#d8ff70", fontWeight: "900" as const },
  pushText: { color: "#829588", fontSize: 9, marginTop: 3 },
  pushMessage: {
    color: "#9eb0a4",
    fontSize: 10,
    textAlign: "center" as const,
    marginTop: 7,
  },
};
const s = StyleSheet.create({
  ...liveStyles,
  safe: { flex: 1, backgroundColor: "#071710" },
  page: { padding: 24, paddingTop: 50, paddingBottom: 50 },
  center: { flex: 1, justifyContent: "center", padding: 24 },
  back: { color: "#d8ff70", fontWeight: "800", marginBottom: 24 },
  kicker: {
    color: "#d8ff70",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.7,
  },
  hero: {
    color: "#f5f8f2",
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "900",
    marginTop: 7,
  },
  body: {
    color: "#91a499",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    marginBottom: 20,
  },
  primary: {
    backgroundColor: "#d8ff70",
    borderRadius: 16,
    padding: 16,
    alignItems: "center",
    marginTop: 13,
  },
  primaryText: { color: "#102015", fontWeight: "900" },
  joinRow: { flexDirection: "row", gap: 8 },
  codeInput: {
    flex: 1,
    backgroundColor: "#0c2116",
    borderRadius: 13,
    padding: 14,
    color: "#fff",
    fontWeight: "900",
    letterSpacing: 3,
  },
  joinButton: {
    backgroundColor: "#d8ff70",
    borderRadius: 13,
    paddingHorizontal: 22,
    justifyContent: "center",
  },
  section: {
    color: "#82988a",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
    marginTop: 28,
    marginBottom: 10,
  },
  card: {
    backgroundColor: "#0d2418",
    borderRadius: 16,
    padding: 16,
    marginBottom: 9,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  cardTitle: { color: "#fff", fontSize: 16, fontWeight: "900" },
  muted: { color: "#829588", fontSize: 11, marginTop: 3 },
  code: { color: "#d8ff70", fontWeight: "900", letterSpacing: 2 },
  error: { color: "#ff8d82", marginTop: 12 },
  label: {
    color: "#82988a",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginTop: 18,
    marginBottom: 7,
  },
  input: {
    backgroundColor: "#0c2116",
    color: "#fff",
    fontSize: 18,
    fontWeight: "800",
    borderRadius: 12,
    padding: 13,
  },
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  step: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#d8ff70",
    alignItems: "center",
    justifyContent: "center",
  },
  stepText: { fontSize: 27, color: "#102015" },
  size: { color: "#fff", fontSize: 25, fontWeight: "900" },
  teamColumns: { flexDirection: "row", gap: 8, marginTop: 15 },
  team: { flex: 1 },
  teamName: {
    backgroundColor: "#183424",
    color: "#d8ff70",
    fontWeight: "900",
    padding: 10,
    borderRadius: 10,
    marginBottom: 5,
  },
  playerInput: {
    backgroundColor: "#0c2116",
    color: "#fff",
    fontSize: 12,
    padding: 9,
    borderRadius: 8,
    marginBottom: 4,
  },
  option: {
    borderWidth: 1,
    borderColor: "#294632",
    borderRadius: 11,
    padding: 12,
    marginBottom: 6,
  },
  optionOn: { borderColor: "#d8ff70", backgroundColor: "#1b3927" },
  optionText: { color: "#fff", fontWeight: "800" },
  formatLine: {
    backgroundColor: "#0c2116",
    borderRadius: 12,
    padding: 11,
    marginBottom: 6,
  },
  formatButtons: { flexDirection: "row", gap: 5, marginTop: 7 },
  mini: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#294632",
    padding: 8,
    borderRadius: 8,
    alignItems: "center",
  },
  miniText: { color: "#fff", fontSize: 10, fontWeight: "800" },
  overall: {
    backgroundColor: "#10291b",
    borderRadius: 18,
    padding: 18,
    flexDirection: "row",
    justifyContent: "space-around",
    alignItems: "center",
    marginTop: 18,
  },
  teamBig: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
  },
  points: {
    color: "#d8ff70",
    fontSize: 38,
    fontWeight: "900",
    textAlign: "center",
  },
  versus: { color: "#62766a", fontSize: 24 },
  match: {
    backgroundColor: "#0d2418",
    borderRadius: 17,
    padding: 15,
    marginBottom: 9,
  },
  matchPlayers: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "900",
    textAlign: "center",
  },
  vs: { color: "#64776b", fontSize: 9, textAlign: "center", marginVertical: 2 },
  status: {
    borderTopWidth: 1,
    borderTopColor: "#26432f",
    marginTop: 10,
    paddingTop: 10,
  },
  statusText: {
    color: "#d8ff70",
    fontSize: 15,
    fontWeight: "900",
    textAlign: "center",
  },
  thru: {
    color: "#788b7f",
    fontSize: 9,
    fontWeight: "800",
    textAlign: "center",
    marginTop: 3,
  },
  hole: { flexDirection: "row", alignItems: "center", gap: 5, marginBottom: 7 },
  holeNumber: { width: 25, color: "#d8ff70", fontWeight: "900" },
  result: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#294632",
    borderRadius: 9,
    paddingVertical: 10,
    paddingHorizontal: 3,
    alignItems: "center",
  },
  resultOn: { backgroundColor: "#d8ff70", borderColor: "#d8ff70" },
  resultText: { color: "#fff", fontSize: 8, fontWeight: "800" },
  clear: { color: "#ff8d82", fontSize: 20 },
});
