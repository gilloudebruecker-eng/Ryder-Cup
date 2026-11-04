import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { StatusBar } from "expo-status-bar";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  CourseId,
  courses,
  Gender,
  GreenPoint,
  Hole,
  TeeColor,
} from "./src/course";
import { distanceMeters } from "./src/distance";
import {
  allocatedStrokes,
  amerikaantjePoints,
  GameFormat,
  matchPlayHole,
  netScores,
  Player,
  relativePlayingHandicaps,
  stableford,
  teamMatchPlayHole,
} from "./src/game";
import { courseHandicap } from "./src/scoring";
import { cloudConfigured, supabase } from "./src/supabase";
import type { Session } from "@supabase/supabase-js";
import RyderCup from "./src/RyderCup";

const GREENS_KEY = "golf-gps-green-centres-v2";
const ROUND_KEY = "golf-gps-multiplayer-round-v2";
const HISTORY_KEY = "golf-round-history-v1";
const STARTED_KEY = "golf-started-rounds-v1";
const DISPLAY_NAME_KEY = "golf-local-display-name-v1";
const DEFAULT_HANDICAP_KEY = "golf-local-default-handicap-v1";
type SavedGreens = Partial<Record<CourseId, Record<number, GreenPoint>>>;
type ViewMode = "play" | "scorecard";
type PastRound = {
  id: string;
  course_id: CourseId;
  format: GameFormat;
  players: Player[];
  played_at: string;
};
type StartedRound = {
  id: string;
  course_id: CourseId;
  format: GameFormat;
  players: Player[];
  updated_at: string;
};
type SharedRound = {
  id: string;
  join_code: string;
  course_id: CourseId;
  format: GameFormat;
  players: Player[];
  hole_index: number;
  round_started: boolean;
  finished: boolean;
  updated_at: string;
};

const newUuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = (Math.random() * 16) | 0;
    return (character === "x" ? random : (random & 3) | 8).toString(16);
  });

const emptyScores = () => Array<number | null>(18).fill(null);
const newPlayer = (index: number): Player => ({
  id: `${Date.now()}-${index}`,
  name: `Player ${index}`,
  gender: "men",
  handicapIndex: 18,
  teeColor: "yellow",
  scores: emptyScores(),
});

const playerStrokeIndex = (hole: Hole, player: Player) =>
  player.gender === "women"
    ? (hole.womenStrokeIndex ?? hole.strokeIndex)
    : hole.strokeIndex;

export default function App() {
  const [courseId, setCourseId] = useState<CourseId | null>(null);
  const [format, setFormat] = useState<GameFormat>("stableford");
  const [players, setPlayers] = useState<Player[]>([newPlayer(1)]);
  const [roundStarted, setRoundStarted] = useState(false);
  const [resumePrompt, setResumePrompt] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ready, setReady] = useState(false);
  const [holeIndex, setHoleIndex] = useState(0);
  const [viewMode, setViewMode] = useState<ViewMode>("play");
  const [setupError, setSetupError] = useState("");
  const [position, setPosition] = useState<Location.LocationObject | null>(
    null,
  );
  const [locationError, setLocationError] = useState<string | null>(null);
  const [greens, setGreens] = useState<SavedGreens>({});
  const [gpsMessage, setGpsMessage] = useState("");
  const [session, setSession] = useState<Session | null>(null);
  const [showAccount, setShowAccount] = useState(false);
  const [showRyderCup, setShowRyderCup] = useState(false);
  const [showStartedRounds, setShowStartedRounds] = useState(false);
  const [showSharedRounds, setShowSharedRounds] = useState(false);
  const [creatingSharedRound, setCreatingSharedRound] = useState(false);
  const [sharedRoundId, setSharedRoundId] = useState<string | null>(null);
  const [sharedJoinCode, setSharedJoinCode] = useState("");
  const [activeDraftId, setActiveDraftId] = useState<string | null>(null);
  const [cloudReady, setCloudReady] = useState(false);
  const [syncStatus, setSyncStatus] = useState<
    "local" | "syncing" | "saved" | "error"
  >("local");
  const [accountName, setAccountName] = useState("");
  const [defaultHandicap, setDefaultHandicap] = useState(18);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const locationSubscription = useRef<
    Location.LocationSubscription | undefined
  >(undefined);
  const applyingSharedRemote = useRef(false);

  const course = courses[courseId ?? "keerbergen"];
  const holes = course.holes;
  const hole = holes[holeIndex]!;
  const savedGreen = greens[course.id]?.[hole.number];
  const green = savedGreen ?? course.defaultGreens?.[hole.number];

  const ratings = players.map(
    (player) =>
      course.teeRatings[player.gender].find(
        (item) => item.color === player.teeColor,
      ) ?? course.teeRatings[player.gender][0]!,
  );
  const courseHandicaps = players.map((player, index) =>
    courseHandicap(player.handicapIndex, ratings[index]!, course.par),
  );
  const relativeHandicaps = relativePlayingHandicaps(courseHandicaps);
  const playingHandicaps =
    format === "stableford" ? courseHandicaps : relativeHandicaps;
  const currentStrokes = players.map((_, index) =>
    allocatedStrokes(
      playingHandicaps[index] ?? 0,
      playerStrokeIndex(hole, players[index]!),
    ),
  );
  const currentGross = players.map(
    (player) => player.scores[holeIndex] ?? null,
  );
  const currentNet = netScores(currentGross, currentStrokes);
  const currentAmerica =
    format === "amerikaantje" ? amerikaantjePoints(currentNet) : null;
  const currentMatchWinner =
    format === "matchplay" ? matchPlayHole(currentNet) : null;
  const teamFormat = format === "matchplay2v2" || format === "fourball";
  const currentTeamWinner = teamFormat
    ? teamMatchPlayHole(currentNet, format === "fourball")
    : null;

  const distance = useMemo(
    () =>
      !position || !green
        ? null
        : Math.round(distanceMeters(position.coords, green)),
    [position, green],
  );
  const holesCompleted = Math.max(
    0,
    ...players.map(
      (player) => player.scores.filter((score) => score !== null).length,
    ),
  );

  useEffect(() => {
    if (Platform.OS !== "web") return;
    const manifest = document.createElement("link");
    manifest.rel = "manifest";
    manifest.href = "/manifest.webmanifest";
    document.head.appendChild(manifest);
    navigator.serviceWorker
      ?.register("/service-worker.js")
      .catch(() => undefined);
    return () => manifest.remove();
  }, []);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(DISPLAY_NAME_KEY),
      AsyncStorage.getItem(DEFAULT_HANDICAP_KEY),
    ]).then(([name, handicap]) => {
      setAccountName(name ?? "");
      const parsed = Number(handicap);
      if (Number.isFinite(parsed) && parsed >= -5 && parsed <= 54)
        setDefaultHandicap(parsed);
    });
  }, []);

  useEffect(() => {
    if (!supabase) {
      setCloudReady(true);
      return;
    }
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setCloudReady(false);
      setSession(data.session);
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (nextSession) setCloudReady(false);
      if (event === "PASSWORD_RECOVERY") setPasswordRecovery(true);
      setSession(nextSession);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !supabase) {
      setCloudReady(true);
      return;
    }
    setSyncStatus("syncing");
    supabase
      .from("golf_rounds")
      .select("round_data")
      .eq("user_id", session.user.id)
      .maybeSingle()
      .then(async ({ data, error }) => {
        if (error) {
          setSyncStatus("error");
          setCloudReady(true);
          return;
        }
        const remote = data?.round_data as any;
        if (
          remote?.courseId in courses &&
          Array.isArray(remote?.players) &&
          remote.players.length
        ) {
          setCourseId(remote.courseId);
          setFormat(remote.format);
          setPlayers(remote.players);
          setRoundStarted(Boolean(remote.roundStarted));
          await AsyncStorage.setItem(ROUND_KEY, JSON.stringify(remote));
          if (remote.roundStarted) setResumePrompt(true);
        }
        setSyncStatus(data ? "saved" : "local");
        setCloudReady(true);
      });
  }, [session?.user.id]);

  async function startGps() {
    setLocationError(null);
    setGpsMessage("Starting GPS...");
    try {
      if (Platform.OS === "web" && !window.isSecureContext)
        throw new Error("GPS requires the secure https version of this app.");
      const servicesEnabled = await Location.hasServicesEnabledAsync();
      if (!servicesEnabled)
        throw new Error("Location Services are switched off on this phone.");
      let permission = await Location.getForegroundPermissionsAsync();
      if (!permission.granted)
        permission = await Location.requestForegroundPermissionsAsync();
      if (!permission.granted)
        throw new Error(
          "Location access is off. Enable Precise Location for this app in your phone settings, then tap Retry GPS.",
        );
      locationSubscription.current?.remove();
      locationSubscription.current = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 2500,
          distanceInterval: 2,
        },
        (nextPosition) => {
          setPosition(nextPosition);
          setLocationError(null);
          setGpsMessage("");
        },
      );
    } catch (error) {
      setLocationError(
        error instanceof Error
          ? error.message
          : "GPS unavailable. Check Location Services and Precise Location.",
      );
      setGpsMessage("");
    }
  }

  useEffect(() => {
    (async () => {
      try {
        const [savedGreens, savedRound] = await Promise.all([
          AsyncStorage.getItem(GREENS_KEY),
          AsyncStorage.getItem(ROUND_KEY),
        ]);
        if (savedGreens) setGreens(JSON.parse(savedGreens));
        if (savedRound) {
          const data = JSON.parse(savedRound);
          if (
            data.courseId in courses &&
            Array.isArray(data.players) &&
            data.players.length
          ) {
            setCourseId(data.courseId);
            setFormat(data.format);
            setPlayers(data.players);
            setRoundStarted(Boolean(data.roundStarted));
            if (data.roundStarted) setResumePrompt(true);
          }
        }
        await startGps();
      } catch (error) {
        setLocationError(
          error instanceof Error
            ? error.message
            : "Your saved data or GPS position could not be read.",
        );
      } finally {
        setReady(true);
      }
    })();
    return () => locationSubscription.current?.remove();
  }, []);

  useEffect(() => {
    if (!ready) return;
    const roundData = { courseId, format, players, roundStarted };
    AsyncStorage.setItem(ROUND_KEY, JSON.stringify(roundData));
    if (!session || !supabase || !cloudReady) {
      setSyncStatus("local");
      return;
    }
    const client = supabase;
    const userId = session.user.id;
    setSyncStatus("syncing");
    const timer = setTimeout(async () => {
      const { error } = await client.from("golf_rounds").upsert({
        user_id: userId,
        round_data: roundData,
        updated_at: new Date().toISOString(),
      });
      setSyncStatus(error ? "error" : "saved");
    }, 700);
    return () => clearTimeout(timer);
  }, [
    ready,
    cloudReady,
    session?.user.id,
    courseId,
    format,
    players,
    roundStarted,
  ]);

  useEffect(() => {
    if (!sharedRoundId || !supabase) return;
    const client = supabase;
    const channel = client
      .channel(`shared-round-${sharedRoundId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "shared_golf_rounds",
          filter: `id=eq.${sharedRoundId}`,
        },
        ({ new: updated }) => {
          const remote = updated as SharedRound;
          applyingSharedRemote.current = true;
          if (Array.isArray(remote.players)) setPlayers(remote.players);
          if (Number.isInteger(remote.hole_index))
            setHoleIndex(Math.max(0, Math.min(17, remote.hole_index)));
          setTimeout(() => {
            applyingSharedRemote.current = false;
          }, 500);
        },
      )
      .subscribe();
    return () => {
      client.removeChannel(channel);
    };
  }, [sharedRoundId]);

  useEffect(() => {
    if (
      !sharedRoundId ||
      !supabase ||
      !roundStarted ||
      applyingSharedRemote.current
    )
      return;
    const client = supabase;
    const timer = setTimeout(() => {
      client
        .from("shared_golf_rounds")
        .update({
          players,
          hole_index: holeIndex,
          updated_at: new Date().toISOString(),
        })
        .eq("id", sharedRoundId)
        .then(({ error }) => error && setSyncStatus("error"));
    }, 350);
    return () => clearTimeout(timer);
  }, [sharedRoundId, roundStarted, players, holeIndex]);

  function chooseCourse(id: CourseId) {
    setCourseId(id);
    setPlayers([
      {
        ...newPlayer(1),
        name: accountName || "Player 1",
        handicapIndex: defaultHandicap,
      },
    ]);
    setFormat("stableford");
    setSetupError("");
  }

  function selectFormat(next: GameFormat) {
    setFormat(next);
    const count =
      next === "matchplay"
        ? 2
        : next === "amerikaantje"
          ? 3
          : next === "matchplay2v2" || next === "fourball"
            ? 4
            : Math.max(1, players.length);
    setPlayers(
      Array.from(
        { length: count },
        (_, index) => players[index] ?? newPlayer(index + 1),
      ),
    );
  }

  function updatePlayer(index: number, update: Partial<Player>) {
    setPlayers((current) =>
      current.map((player, i) =>
        i === index ? { ...player, ...update } : player,
      ),
    );
  }

  function changeGender(index: number, gender: Gender) {
    const available = course.teeRatings[gender];
    const current = players[index]!;
    updatePlayer(index, {
      gender,
      teeColor: available.some((tee) => tee.color === current.teeColor)
        ? current.teeColor
        : available[0]!.color,
    });
  }

  async function startRound() {
    if (players.some((player) => !player.name.trim())) {
      setSetupError("Enter a name for every player.");
      return;
    }
    if (
      players.some(
        (player) => player.handicapIndex < -5 || player.handicapIndex > 54,
      )
    ) {
      setSetupError("Every Handicap Index must be between -5 and 54.");
      return;
    }
    const preparedPlayers = players.map((player) => ({
      ...player,
      name: player.name.trim(),
      scores: emptyScores(),
    }));
    if (creatingSharedRound) {
      if (!session || !supabase || !courseId) {
        setSetupError("Sign in before creating a shared round.");
        return;
      }
      const joinCode = Math.random().toString(36).slice(2, 8).toUpperCase();
      const { data, error } = await supabase.rpc("create_shared_golf_round", {
        invite_code: joinCode,
        selected_course_id: courseId,
        selected_format: format,
        round_players: preparedPlayers,
      });
      if (error) {
        setSetupError(
          `Shared round could not be created: ${error.message}. Run supabase-shared-rounds.sql first.`,
        );
        return;
      }
      setSharedRoundId(data as string);
      setSharedJoinCode(joinCode);
      setCreatingSharedRound(false);
    }
    setPlayers(preparedPlayers);
    setHoleIndex(0);
    setViewMode("play");
    setRoundStarted(true);
    setSetupError("");
  }

  async function endRound(saveToHistory = false) {
    if (
      saveToHistory &&
      courseId &&
      players.some((player) => player.scores.some((score) => score !== null))
    ) {
      const record: PastRound = {
        id: newUuid(),
        course_id: courseId,
        format,
        players,
        played_at: new Date().toISOString(),
      };
      const saved = JSON.parse(
        (await AsyncStorage.getItem(HISTORY_KEY)) ?? "[]",
      ) as PastRound[];
      await AsyncStorage.setItem(
        HISTORY_KEY,
        JSON.stringify([record, ...saved].slice(0, 50)),
      );
      if (session && supabase)
        await supabase.from("golf_round_history").insert({
          id: record.id,
          user_id: session.user.id,
          course_id: record.course_id,
          format: record.format,
          players: record.players,
          played_at: record.played_at,
        });
    }
    if (saveToHistory && sharedRoundId && supabase)
      await supabase
        .from("shared_golf_rounds")
        .update({ finished: true, updated_at: new Date().toISOString() })
        .eq("id", sharedRoundId);
    if (activeDraftId) await deleteStartedRound(activeDraftId);
    resetToHome();
  }

  function resetToHome() {
    setPlayers([
      {
        ...newPlayer(1),
        name: accountName || "Player 1",
        handicapIndex: defaultHandicap,
      },
    ]);
    setCourseId(null);
    setRoundStarted(false);
    setResumePrompt(false);
    setConfirmEnd(false);
    setViewMode("play");
    setHoleIndex(0);
    setActiveDraftId(null);
    setSharedRoundId(null);
    setSharedJoinCode("");
    setCreatingSharedRound(false);
  }

  function openSharedRound(round: SharedRound) {
    setCourseId(round.course_id);
    setFormat(round.format);
    setPlayers(round.players);
    setHoleIndex(Math.max(0, Math.min(17, round.hole_index ?? 0)));
    setRoundStarted(true);
    setViewMode("play");
    setSharedRoundId(round.id);
    setSharedJoinCode(round.join_code);
    setResumePrompt(false);
    setShowSharedRounds(false);
  }

  async function saveForLater() {
    if (!courseId) return;
    const record: StartedRound = {
      id: activeDraftId ?? newUuid(),
      course_id: courseId,
      format,
      players,
      updated_at: new Date().toISOString(),
    };
    const saved = JSON.parse(
      (await AsyncStorage.getItem(STARTED_KEY)) ?? "[]",
    ) as StartedRound[];
    await AsyncStorage.setItem(
      STARTED_KEY,
      JSON.stringify(
        [record, ...saved.filter((round) => round.id !== record.id)].slice(
          0,
          25,
        ),
      ),
    );
    if (session && supabase)
      await supabase.from("golf_started_rounds").upsert({
        id: record.id,
        user_id: session.user.id,
        course_id: record.course_id,
        format: record.format,
        players: record.players,
        updated_at: record.updated_at,
      });
    resetToHome();
  }

  async function deleteStartedRound(id: string) {
    const saved = JSON.parse(
      (await AsyncStorage.getItem(STARTED_KEY)) ?? "[]",
    ) as StartedRound[];
    await AsyncStorage.setItem(
      STARTED_KEY,
      JSON.stringify(saved.filter((round) => round.id !== id)),
    );
    if (session && supabase)
      await supabase.from("golf_started_rounds").delete().eq("id", id);
  }

  function resumeStartedRound(round: StartedRound) {
    setCourseId(round.course_id);
    setFormat(round.format);
    setPlayers(round.players);
    setRoundStarted(true);
    setActiveDraftId(round.id);
    setHoleIndex(0);
    setViewMode("play");
    setShowStartedRounds(false);
  }

  function changeScore(playerIndex: number, delta: number) {
    setPlayers((current) =>
      current.map((player, index) => {
        if (index !== playerIndex) return player;
        const scores = [...player.scores];
        const existing = scores[holeIndex] ?? null;
        scores[holeIndex] =
          existing === null
            ? hole.par + (currentStrokes[playerIndex] ?? 0)
            : Math.max(1, Math.min(20, existing + delta));
        return { ...player, scores };
      }),
    );
  }

  function clearScore(playerIndex: number) {
    setPlayers((current) =>
      current.map((player, index) =>
        index !== playerIndex
          ? player
          : {
              ...player,
              scores: player.scores.map((score, i) =>
                i === holeIndex ? null : score,
              ),
            },
      ),
    );
  }

  async function saveGreenCenter() {
    if (!position) {
      setGpsMessage("Waiting for a GPS position.");
      return;
    }
    const accuracy = position.coords.accuracy ?? 999;
    if (accuracy > 12) {
      setGpsMessage(
        `Wait for better GPS accuracy (currently ±${Math.round(accuracy)} m).`,
      );
      return;
    }
    const next = {
      ...greens,
      [course.id]: {
        ...greens[course.id],
        [hole.number]: {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
        },
      },
    };
    setGreens(next);
    await AsyncStorage.setItem(GREENS_KEY, JSON.stringify(next));
    setGpsMessage(`Green ${hole.number} calibrated.`);
  }

  function playerHolePoints(playerIndex: number, index: number): number | null {
    const targetHole = holes[index]!;
    const strokes = allocatedStrokes(
      playingHandicaps[playerIndex] ?? 0,
      playerStrokeIndex(targetHole, players[playerIndex]!),
    );
    const gross = players[playerIndex]!.scores[index] ?? null;
    if (format === "stableford") return stableford(gross, targetHole, strokes);
    const grossAll = players.map((player) => player.scores[index] ?? null);
    const strokeAll = players.map((_, p) =>
      allocatedStrokes(
        playingHandicaps[p] ?? 0,
        playerStrokeIndex(targetHole, players[p]!),
      ),
    );
    const net = netScores(grossAll, strokeAll);
    if (format === "amerikaantje")
      return amerikaantjePoints(net)?.[playerIndex] ?? null;
    if (format === "matchplay2v2" || format === "fourball") {
      const winner = teamMatchPlayHole(net, format === "fourball");
      const team = playerIndex < 2 ? 0 : 1;
      return winner === team
        ? 1
        : winner === -1
          ? 0.5
          : winner === null
            ? null
            : 0;
    }
    const winner = matchPlayHole(net);
    return winner === playerIndex
      ? 1
      : winner === -1
        ? 0.5
        : winner === null
          ? null
          : 0;
  }

  function playerTotal(playerIndex: number): number {
    return holes.reduce(
      (sum, _, index) => sum + (playerHolePoints(playerIndex, index) ?? 0),
      0,
    );
  }

  if (!ready)
    return (
      <SafeAreaView style={styles.safe}>
        <ActivityIndicator color="#d8ff70" size="large" style={{ flex: 1 }} />
      </SafeAreaView>
    );

  if (showAccount)
    return (
      <AccountScreen
        session={session}
        displayName={accountName}
        onDisplayName={setAccountName}
        defaultHandicap={defaultHandicap}
        onDefaultHandicap={setDefaultHandicap}
        passwordRecovery={passwordRecovery}
        onRecoveryComplete={() => setPasswordRecovery(false)}
        onAuthenticated={() => setShowAccount(false)}
        onClose={() => setShowAccount(false)}
      />
    );
  if (showRyderCup)
    return (
      <RyderCup
        session={session}
        onClose={() => setShowRyderCup(false)}
        onSignIn={() => setShowAccount(true)}
      />
    );
  if (showStartedRounds)
    return (
      <StartedRoundsScreen
        session={session}
        onClose={() => setShowStartedRounds(false)}
        onResume={resumeStartedRound}
        onDelete={deleteStartedRound}
      />
    );
  if (showSharedRounds)
    return (
      <SharedRoundsScreen
        session={session}
        onClose={() => setShowSharedRounds(false)}
        onSignIn={() => {
          setShowSharedRounds(false);
          setShowAccount(true);
        }}
        onCreate={() => {
          setCreatingSharedRound(true);
          setShowSharedRounds(false);
        }}
        onOpen={openSharedRound}
      />
    );

  if (resumePrompt && roundStarted)
    return (
      <ResumeScreen
        courseName={course.shortName}
        completed={holesCompleted}
        players={players}
        totals={players.map((_, i) => playerTotal(i))}
        onContinue={() => setResumePrompt(false)}
        onDiscard={() => endRound(false)}
      />
    );
  if (!roundStarted && !courseId)
    return (
      <HomeScreen
        onChoose={chooseCourse}
        accountLabel={session ? accountName || "Account" : "Sign in"}
        syncStatus={syncStatus}
        gpsReady={Boolean(position)}
        gpsAccuracy={position?.coords.accuracy ?? null}
        gpsError={locationError}
        onEnableLocation={startGps}
        onAccount={() => setShowAccount(true)}
        onRyderCup={() => setShowRyderCup(true)}
        onStartedRounds={() => setShowStartedRounds(true)}
        onSharedRounds={() => setShowSharedRounds(true)}
        creatingSharedRound={creatingSharedRound}
      />
    );
  if (!roundStarted)
    return (
      <SetupScreen
        course={course}
        format={format}
        players={players}
        ratings={ratings}
        courseHandicaps={courseHandicaps}
        error={setupError}
        onBack={() => setCourseId(null)}
        onFormat={selectFormat}
        onPlayer={updatePlayer}
        onGender={changeGender}
        onAdd={() =>
          players.length < 4 &&
          setPlayers([...players, newPlayer(players.length + 1)])
        }
        onRemove={(index: number) =>
          players.length > 1 &&
          setPlayers(players.filter((_, i) => i !== index))
        }
        onStart={startRound}
        shared={creatingSharedRound}
      />
    );

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <View>
            <Text style={styles.eyebrow}>{course.shortName.toUpperCase()}</Text>
            {sharedJoinCode ? (
              <Text style={styles.sharedCode}>LIVE CODE {sharedJoinCode}</Text>
            ) : null}
            <Text style={styles.title}>
              {viewMode === "play" ? `Hole ${hole.number}` : "Scorecard"}
            </Text>
          </View>
          <Pressable onPress={() => setShowAccount(true)}>
            <Text style={styles.liveText}>
              {session
                ? syncStatus === "saved"
                  ? "CLOUD SAVED"
                  : syncStatus === "syncing"
                    ? "SYNCING..."
                    : "ACCOUNT"
                : position
                  ? "GPS LIVE"
                  : "GPS"}
            </Text>
          </Pressable>
        </View>
        {viewMode === "play" ? (
          <>
            <View style={styles.distanceCard}>
              <Text style={styles.label}>DISTANCE TO CENTRE</Text>
              {distance !== null ? (
                <>
                  <View style={styles.distanceRow}>
                    <Text style={styles.distance}>{distance}</Text>
                    <Text style={styles.unit}>m</Text>
                  </View>
                  <Text style={styles.greenSource}>
                    {savedGreen ? "CALIBRATED" : "PUBLIC MAP ESTIMATE"}
                  </Text>
                </>
              ) : (
                <>
                  <Text style={styles.noDistance}>
                    {locationError ?? "Waiting for an accurate GPS position..."}
                  </Text>
                  {locationError ? (
                    <Pressable onPress={startGps} style={styles.gpsRetry}>
                      <Text style={styles.gpsRetryText}>Retry GPS</Text>
                    </Pressable>
                  ) : null}
                </>
              )}
            </View>
            <View style={styles.holeNav}>
              <Pressable
                onPress={() => setHoleIndex(Math.max(0, holeIndex - 1))}
                style={styles.navButton}
              >
                <Text style={styles.navText}>‹</Text>
              </Pressable>
              <View style={{ alignItems: "center" }}>
                <Text style={styles.holeBig}>{hole.number}</Text>
                <Text style={styles.par}>
                  PAR {hole.par} · SI M {hole.strokeIndex}
                  {hole.womenStrokeIndex ? ` · W ${hole.womenStrokeIndex}` : ""}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  if (holeIndex === holes.length - 1) setViewMode("scorecard");
                  else setHoleIndex(holeIndex + 1);
                }}
                style={styles.navButton}
              >
                <Text style={styles.navText}>
                  {holeIndex === holes.length - 1 ? "✓" : "›"}
                </Text>
              </Pressable>
            </View>
            <View style={styles.holeResult}>
              <Text style={styles.holeResultText}>
                {format === "matchplay"
                  ? currentMatchWinner === -1
                    ? "Hole tied"
                    : currentMatchWinner === null
                      ? "Enter both scores"
                      : `${players[currentMatchWinner]!.name} wins the hole`
                  : teamFormat
                    ? currentTeamWinner === -1
                      ? "Hole tied"
                      : currentTeamWinner === null
                        ? "Enter all four scores"
                        : `${currentTeamWinner === 0 ? `${players[0]!.name} & ${players[1]!.name}` : `${players[2]!.name} & ${players[3]!.name}`} win the hole`
                    : format === "amerikaantje"
                      ? currentAmerica
                        ? currentAmerica
                            .map((points, i) => `${players[i]!.name} ${points}`)
                            .join(" · ")
                        : "Enter all three scores"
                      : "Individual Stableford"}
              </Text>
            </View>
            {players.map((player, index) => {
              const team = index < 2 ? 0 : 1;
              const points =
                format === "stableford"
                  ? stableford(
                      currentGross[index]!,
                      hole,
                      currentStrokes[index]!,
                    )
                  : format === "amerikaantje"
                    ? (currentAmerica?.[index] ?? null)
                    : teamFormat
                      ? currentTeamWinner === team
                        ? 1
                        : currentTeamWinner === -1
                          ? 0.5
                          : currentTeamWinner === null
                            ? null
                            : 0
                      : currentMatchWinner === index
                        ? 1
                        : currentMatchWinner === -1
                          ? 0.5
                          : currentMatchWinner === null
                            ? null
                            : 0;
              return (
                <View key={player.id} style={styles.playerScore}>
                  <View style={styles.playerScoreTop}>
                    <View>
                      <Text style={styles.playerName}>{player.name}</Text>
                      <Text style={styles.playerMeta}>
                        {teamFormat ? `TEAM ${team === 0 ? "A" : "B"} · ` : ""}
                        CH {courseHandicaps[index]} · Playing{" "}
                        {playingHandicaps[index]} · {currentStrokes[index]}{" "}
                        stroke{currentStrokes[index] === 1 ? "" : "s"}
                      </Text>
                    </View>
                    <View style={styles.pointBadge}>
                      <Text style={styles.pointNumber}>
                        {currentGross[index] === null || points === null
                          ? "–"
                          : points}
                      </Text>
                      <Text style={styles.pointLabel}>
                        {format === "matchplay" || teamFormat ? "WIN" : "PTS"}
                      </Text>
                    </View>
                  </View>
                  <View style={styles.counter}>
                    <Pressable
                      onPress={() => changeScore(index, -1)}
                      style={styles.counterButton}
                    >
                      <Text style={styles.counterText}>−</Text>
                    </Pressable>
                    <View style={{ alignItems: "center" }}>
                      <Text style={styles.scoreNumber}>
                        {currentGross[index] ?? "–"}
                      </Text>
                      <Text style={styles.scoreCaption}>GROSS STROKES</Text>
                    </View>
                    <Pressable
                      onPress={() => changeScore(index, 1)}
                      style={styles.counterButton}
                    >
                      <Text style={styles.counterText}>+</Text>
                    </Pressable>
                  </View>
                  {currentGross[index] !== null && (
                    <Pressable onPress={() => clearScore(index)}>
                      <Text style={styles.clear}>Clear</Text>
                    </Pressable>
                  )}
                </View>
              );
            })}
            <Pressable onPress={saveGreenCenter} style={styles.calibrate}>
              <Text style={styles.calibrateText}>
                {savedGreen ? "Recalibrate green" : "Correct green centre"}
              </Text>
            </Pressable>
            {gpsMessage ? (
              <Text style={styles.gpsMessage}>{gpsMessage}</Text>
            ) : null}
          </>
        ) : (
          <Scorecard
            course={course}
            format={format}
            players={players}
            playingHandicaps={playingHandicaps}
            totals={players.map((_, i) => playerTotal(i))}
          />
        )}
        {confirmEnd && (
          <View style={styles.confirm}>
            <Text style={styles.confirmTitle}>Leave this round?</Text>
            <Text style={styles.confirmBody}>
              Save it for later, finish it, or discard it permanently.
            </Text>
            <Pressable onPress={saveForLater} style={styles.start}>
              <Text style={styles.startText}>Save for later</Text>
            </Pressable>
            <View style={styles.confirmRow}>
              <Pressable
                onPress={() => endRound(true)}
                style={styles.secondary}
              >
                <Text style={styles.secondaryText}>Finish & archive</Text>
              </Pressable>
              <Pressable onPress={() => endRound(false)} style={styles.danger}>
                <Text style={styles.dangerText}>Discard round</Text>
              </Pressable>
            </View>
            <Pressable
              onPress={() => setConfirmEnd(false)}
              style={styles.secondaryWide}
            >
              <Text style={styles.secondaryText}>Cancel · keep playing</Text>
            </Pressable>
          </View>
        )}
        <View style={styles.bottomNav}>
          <Pressable
            onPress={() => setViewMode("play")}
            style={[
              styles.bottomButton,
              viewMode === "play" && styles.bottomActive,
            ]}
          >
            <Text style={styles.bottomText}>PLAY</Text>
          </Pressable>
          <Pressable
            onPress={() => setViewMode("scorecard")}
            style={[
              styles.bottomButton,
              viewMode === "scorecard" && styles.bottomActive,
            ]}
          >
            <Text style={styles.bottomText}>SCORECARD</Text>
          </Pressable>
          <Pressable
            onPress={() => setConfirmEnd(true)}
            style={styles.bottomButton}
          >
            <Text style={styles.bottomText}>HOME</Text>
          </Pressable>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function HomeScreen({
  onChoose,
  accountLabel,
  syncStatus,
  gpsReady,
  gpsAccuracy,
  gpsError,
  onEnableLocation,
  onAccount,
  onRyderCup,
  onStartedRounds,
  onSharedRounds,
  creatingSharedRound,
}: {
  onChoose: (id: CourseId) => void;
  accountLabel: string;
  syncStatus: string;
  gpsReady: boolean;
  gpsAccuracy: number | null;
  gpsError: string | null;
  onEnableLocation: () => Promise<void>;
  onAccount: () => void;
  onRyderCup: () => void;
  onStartedRounds: () => void;
  onSharedRounds: () => void;
  creatingSharedRound: boolean;
}) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.setup}>
        <View style={styles.accountBar}>
          <View>
            <Text style={styles.eyebrow}>GOLF GPS · MULTIPLAYER</Text>
            <Text style={styles.accountState}>
              {syncStatus === "saved"
                ? "Progress saved online"
                : "Local progress enabled"}
            </Text>
          </View>
          <Pressable onPress={onAccount} style={styles.accountButton}>
            <Text style={styles.accountButtonText}>{accountLabel}</Text>
          </Pressable>
        </View>
        <Pressable onPress={onStartedRounds} style={styles.startedCard}>
          <View>
            <Text style={styles.ryderKicker}>SAVED · CONTINUE LATER</Text>
            <Text style={styles.startedTitle}>Started Rounds</Text>
          </View>
          <Text style={styles.historyArrow}>›</Text>
        </Pressable>
        <Pressable onPress={onSharedRounds} style={styles.sharedRoundCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ryderKicker}>LIVE · SAME SCORECARD</Text>
            <Text style={styles.startedTitle}>Shared Live Round</Text>
            <Text style={styles.sharedRoundText}>
              Every game format · everyone can enter scores live.
            </Text>
          </View>
          <Text style={styles.historyArrow}>›</Text>
        </Pressable>
        {creatingSharedRound ? (
          <View style={styles.sharedBanner}>
            <Text style={styles.sharedBannerTitle}>
              Creating a shared round
            </Text>
            <Text style={styles.sharedRoundText}>
              Choose a course, add the players and start. A join code will then
              appear.
            </Text>
          </View>
        ) : null}
        <Pressable onPress={onRyderCup} style={styles.ryderCard}>
          <Text style={styles.ryderKicker}>
            GPS-FREE · LIVE FOR EVERY PLAYER
          </Text>
          <Text style={styles.ryderTitle}>Ryder Cup Live</Text>
          <Text style={styles.ryderText}>
            Create teams, share a join code and follow every matchup live.
          </Text>
        </Pressable>
        <View style={styles.locationCard}>
          <View style={{ flex: 1 }}>
            <Text style={styles.ryderKicker}>LOCATION & DISTANCES</Text>
            <Text style={styles.locationTitle}>
              {gpsReady ? "GPS is ready" : "Enable location tracking"}
            </Text>
            <Text style={styles.locationText}>
              {gpsReady
                ? `Live location active${gpsAccuracy ? ` · accuracy ±${Math.round(gpsAccuracy)} m` : ""}`
                : (gpsError ??
                  "Allow Precise Location to measure your distance to each green.")}
            </Text>
          </View>
          <Pressable onPress={onEnableLocation} style={styles.locationButton}>
            <Text style={styles.locationButtonText}>
              {gpsReady ? "Refresh" : "Enable"}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.setupTitle}>Choose a course</Text>
        <Text style={styles.intro}>
          GPS distances, Stableford, Match Play and Amerikaantje.
        </Text>
        <View style={{ gap: 11 }}>
          {Object.values(courses).map((course) => (
            <Pressable
              key={course.id}
              onPress={() => onChoose(course.id)}
              style={styles.courseCard}
            >
              <View style={styles.courseTop}>
                <Text style={styles.flag}>
                  {course.location.includes("Belgium") ? "🇧🇪" : "🇳🇱"}
                </Text>
                <Text style={styles.coursePar}>PAR {course.par}</Text>
              </View>
              <Text style={styles.courseName}>{course.shortName}</Text>
              <Text style={styles.courseLocation}>{course.location}</Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function SharedRoundsScreen({
  session,
  onClose,
  onSignIn,
  onCreate,
  onOpen,
}: {
  session: Session | null;
  onClose: () => void;
  onSignIn: () => void;
  onCreate: () => void;
  onOpen: (round: SharedRound) => void;
}) {
  const [joinCode, setJoinCode] = useState("");
  const [rounds, setRounds] = useState<SharedRound[]>([]);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(Boolean(session));

  async function loadRounds() {
    if (!supabase || !session) return;
    const { data, error } = await supabase
      .from("shared_golf_rounds")
      .select("*")
      .eq("finished", false)
      .order("updated_at", { ascending: false });
    if (error) setMessage(error.message);
    else setRounds((data ?? []) as SharedRound[]);
    setLoading(false);
  }

  useEffect(() => {
    loadRounds();
  }, [session?.user.id]);

  async function join() {
    if (!supabase || !joinCode.trim()) {
      setMessage("Enter the six-character code.");
      return;
    }
    setMessage("");
    const { data: roundId, error } = await supabase.rpc(
      "join_shared_golf_round",
      { invite_code: joinCode.trim().toUpperCase() },
    );
    if (error) {
      setMessage(error.message);
      return;
    }
    const { data: round, error: loadError } = await supabase
      .from("shared_golf_rounds")
      .select("*")
      .eq("id", roundId)
      .single();
    if (loadError) setMessage(loadError.message);
    else onOpen(round as SharedRound);
  }

  if (!session)
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.resume}>
          <Pressable onPress={onClose}>
            <Text style={styles.back}>‹ Back</Text>
          </Pressable>
          <Text style={styles.eyebrow}>SHARED LIVE ROUND</Text>
          <Text style={styles.setupTitle}>Sign in to play together</Text>
          <Text style={styles.intro}>
            Every participant needs an account so the shared scorecard remains
            private and synchronized.
          </Text>
          <Pressable onPress={onSignIn} style={styles.start}>
            <Text style={styles.startText}>Sign in</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.accountPage}>
        <Pressable onPress={onClose}>
          <Text style={styles.back}>‹ Back to Home</Text>
        </Pressable>
        <Text style={styles.eyebrow}>LIVE SHARED SCORECARD</Text>
        <Text style={styles.setupTitle}>Shared Live Round</Text>
        <Text style={styles.intro}>
          Enter a code to join the same scorecard, or create a new shared round.
        </Text>
        <Text style={styles.inputLabel}>Six-character join code</Text>
        <View style={styles.sharedJoinRow}>
          <TextInput
            value={joinCode}
            onChangeText={setJoinCode}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={6}
            placeholder="ABC123"
            placeholderTextColor="#64776a"
            style={[styles.nameInput, { flex: 1, marginTop: 0 }]}
          />
          <Pressable onPress={join} style={styles.locationButton}>
            <Text style={styles.locationButtonText}>Join</Text>
          </Pressable>
        </View>
        {message ? <Text style={styles.error}>{message}</Text> : null}
        <Pressable onPress={onCreate} style={styles.start}>
          <Text style={styles.startText}>Create shared round</Text>
        </Pressable>
        <Text style={styles.sectionLabel}>MY ACTIVE SHARED ROUNDS</Text>
        {loading ? (
          <ActivityIndicator color="#d8ff70" />
        ) : rounds.length ? (
          rounds.map((round) => (
            <Pressable
              key={round.id}
              onPress={() => onOpen(round)}
              style={styles.historyCard}
            >
              <View>
                <Text style={styles.historyCourse}>
                  {courses[round.course_id].shortName}
                </Text>
                <Text style={styles.historyMeta}>
                  Code {round.join_code} · Hole {round.hole_index + 1} ·{" "}
                  {round.format.toUpperCase()} · {round.players.length} players
                </Text>
              </View>
              <Text style={styles.historyArrow}>›</Text>
            </Pressable>
          ))
        ) : (
          <Text style={styles.intro}>No active shared rounds yet.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StartedRoundsScreen({
  session,
  onClose,
  onResume,
  onDelete,
}: {
  session: Session | null;
  onClose: () => void;
  onResume: (round: StartedRound) => void;
  onDelete: (id: string) => Promise<void>;
}) {
  const [rounds, setRounds] = useState<StartedRound[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  useEffect(() => {
    (async () => {
      const local = JSON.parse(
        (await AsyncStorage.getItem(STARTED_KEY)) ?? "[]",
      ) as StartedRound[];
      if (session && supabase) {
        const { data } = await supabase
          .from("golf_started_rounds")
          .select("id,course_id,format,players,updated_at")
          .order("updated_at", { ascending: false });
        setRounds(data?.length ? (data as StartedRound[]) : local);
      } else setRounds(local);
      setLoading(false);
    })();
  }, [session?.user.id]);
  async function remove(id: string) {
    await onDelete(id);
    setRounds((current) => current.filter((round) => round.id !== id));
    setPendingDelete(null);
  }
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.accountPage}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Pressable onPress={onClose}>
          <Text style={styles.back}>‹ Home</Text>
        </Pressable>
        <Text style={styles.eyebrow}>SAVED FOR LATER</Text>
        <Text style={styles.setupTitle}>Started Rounds</Text>
        <Text style={styles.intro}>
          Resume a round on any signed-in device, or remove it permanently.
        </Text>
        {loading ? (
          <ActivityIndicator color="#d8ff70" />
        ) : rounds.length ? (
          rounds.map((round) => {
            const played = Math.max(
              0,
              ...round.players.map(
                (player) =>
                  player.scores.filter((score) => score !== null).length,
              ),
            );
            return (
              <View key={round.id} style={styles.startedRound}>
                <Pressable onPress={() => onResume(round)} style={{ flex: 1 }}>
                  <Text style={styles.historyCourse}>
                    {courses[round.course_id]?.shortName ?? round.course_id}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {round.format.toUpperCase()} · {played}/18 holes ·{" "}
                    {round.players.map((player) => player.name).join(", ")}
                  </Text>
                  <Text style={styles.continueText}>Continue round ›</Text>
                </Pressable>
                {pendingDelete === round.id ? (
                  <View style={styles.deleteConfirm}>
                    <Text style={styles.historyMeta}>Delete permanently?</Text>
                    <Pressable onPress={() => remove(round.id)}>
                      <Text style={styles.deleteYes}>Yes, delete</Text>
                    </Pressable>
                    <Pressable onPress={() => setPendingDelete(null)}>
                      <Text style={styles.secondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setPendingDelete(round.id)}>
                    <Text style={styles.remove}>Delete</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        ) : (
          <Text style={styles.intro}>No saved rounds yet.</Text>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function AccountScreen({
  session,
  displayName,
  onDisplayName,
  defaultHandicap,
  onDefaultHandicap,
  passwordRecovery,
  onRecoveryComplete,
  onAuthenticated,
  onClose,
}: {
  session: Session | null;
  displayName: string;
  onDisplayName: (name: string) => void;
  defaultHandicap: number;
  onDefaultHandicap: (handicap: number) => void;
  passwordRecovery: boolean;
  onRecoveryComplete: () => void;
  onAuthenticated: () => void;
  onClose: () => void;
}) {
  const [authMode, setAuthMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [signupConfirm, setSignupConfirm] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [nameDraft, setNameDraft] = useState(displayName);
  const [handicapDraft, setHandicapDraft] = useState(defaultHandicap);
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<PastRound[]>([]);
  const [selectedRound, setSelectedRound] = useState<PastRound | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [pendingHistoryDelete, setPendingHistoryDelete] = useState<
    string | null
  >(null);
  useEffect(() => setNameDraft(displayName), [displayName]);
  useEffect(() => setHandicapDraft(defaultHandicap), [defaultHandicap]);
  useEffect(() => {
    (async () => {
      const local = JSON.parse(
        (await AsyncStorage.getItem(HISTORY_KEY)) ?? "[]",
      ) as PastRound[];
      if (session && supabase) {
        const { data } = await supabase
          .from("golf_round_history")
          .select("id,course_id,format,players,played_at")
          .order("played_at", { ascending: false })
          .limit(50);
        setHistory(data?.length ? (data as PastRound[]) : local);
      } else setHistory(local);
      setHistoryLoading(false);
    })();
  }, [session?.user.id]);
  async function saveLocalProfile() {
    const cleanName = nameDraft.trim().slice(0, 30);
    await Promise.all([
      AsyncStorage.setItem(DISPLAY_NAME_KEY, cleanName),
      AsyncStorage.setItem(DEFAULT_HANDICAP_KEY, String(handicapDraft)),
    ]);
    onDisplayName(cleanName);
    onDefaultHandicap(handicapDraft);
    setNameDraft(cleanName);
    setMessage("Name and Handicap Index saved on this device.");
  }
  async function passwordAuth(create: boolean) {
    if (!supabase || !email.trim() || password.length < 6) {
      setMessage("Enter an email and a password of at least 6 characters.");
      return;
    }
    if (create && password !== signupConfirm) {
      setMessage("The two passwords do not match.");
      return;
    }
    setSending(true);
    setMessage("");
    try {
      const cleanEmail = email.trim().toLowerCase();
      const result = create
        ? await supabase.auth.signUp({
            email: cleanEmail,
            password,
            options: {
              emailRedirectTo:
                Platform.OS === "web"
                  ? `${window.location.origin}/`
                  : undefined,
            },
          })
        : await supabase.auth.signInWithPassword({
            email: cleanEmail,
            password,
          });
      if (result.error) setMessage(`Login error: ${result.error.message}`);
      else if (create && !result.data.session) {
        setMessage(
          "Account created. Check your email once, then return to the Sign in tab.",
        );
        setAuthMode("signin");
      } else {
        setMessage(create ? "Account created." : "Signed in.");
        onAuthenticated();
      }
    } catch {
      setMessage(
        "Could not connect to Supabase. Check your internet connection and try again.",
      );
    } finally {
      setSending(false);
    }
  }
  async function setAccountPassword() {
    if (!supabase || !session?.user.email) return;
    if (!passwordRecovery && !currentPassword) {
      setMessage("Enter your current password first.");
      return;
    }
    if (newPassword.length < 6) {
      setMessage("Your new password must contain at least 6 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage("The two new passwords do not match.");
      return;
    }
    setSending(true);
    if (!passwordRecovery) {
      setMessage("Checking your current password...");
      const verification = await supabase.auth.signInWithPassword({
        email: session.user.email,
        password: currentPassword,
      });
      if (verification.error) {
        setMessage("Current password is incorrect. Nothing was changed.");
        setSending(false);
        return;
      }
    }
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setMessage(
      error
        ? error.message
        : "Password changed successfully. Your new password is now active.",
    );
    if (!error) {
      onRecoveryComplete();
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    }
    setSending(false);
  }
  async function sendPasswordReset(targetEmail = email) {
    if (!supabase || !targetEmail.trim()) {
      setMessage("Enter your email address first.");
      return;
    }
    setSending(true);
    setMessage("");
    const redirectTo =
      Platform.OS === "web" ? `${window.location.origin}/` : undefined;
    const { error } = await supabase.auth.resetPasswordForEmail(
      targetEmail.trim(),
      { redirectTo },
    );
    setMessage(
      error
        ? error.message
        : "Password email sent. Open it on this phone and choose a new password.",
    );
    setSending(false);
  }
  async function signOut() {
    await supabase?.auth.signOut();
    setMessage("Signed out. Progress remains stored on this device.");
  }
  async function deletePastRound(round: PastRound) {
    const local = JSON.parse(
      (await AsyncStorage.getItem(HISTORY_KEY)) ?? "[]",
    ) as PastRound[];
    await AsyncStorage.setItem(
      HISTORY_KEY,
      JSON.stringify(
        local.filter(
          (item) =>
            item.id !== round.id &&
            !(
              item.course_id === round.course_id &&
              item.played_at === round.played_at
            ),
        ),
      ),
    );
    if (session && supabase)
      await supabase.from("golf_round_history").delete().eq("id", round.id);
    setHistory((current) => current.filter((item) => item.id !== round.id));
    setPendingHistoryDelete(null);
  }
  if (selectedRound)
    return (
      <PastRoundDetail
        round={selectedRound}
        onBack={() => setSelectedRound(null)}
      />
    );
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.accountPage}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator
      >
        <Pressable onPress={onClose}>
          <Text style={styles.back}>‹ Back</Text>
        </Pressable>
        <Text style={styles.eyebrow}>YOUR ACCOUNT</Text>
        <Text style={styles.setupTitle}>
          {session
            ? displayName || "Signed in"
            : authMode === "signin"
              ? "Sign in"
              : "Create account"}
        </Text>
        {session ? (
          <>
            <Text style={styles.intro}>
              {session.user.email}
              {"\n"}Your active round and finished rounds are synchronized.
            </Text>
            {passwordRecovery ? (
              <>
                <Text style={styles.sectionLabel}>CHOOSE A NEW PASSWORD</Text>
                <Text style={styles.intro}>
                  Your recovery link is accepted. Choose and confirm your new
                  password below.
                </Text>
                <Text style={styles.inputLabel}>New password</Text>
                <TextInput
                  value={newPassword}
                  onChangeText={setNewPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  placeholder="New password · at least 6 characters"
                  placeholderTextColor="#64776a"
                  style={styles.nameInput}
                />
                <Text style={styles.inputLabel}>Confirm new password</Text>
                <TextInput
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  secureTextEntry
                  autoCapitalize="none"
                  autoComplete="new-password"
                  placeholder="Confirm new password"
                  placeholderTextColor="#64776a"
                  style={styles.nameInput}
                />
                <Pressable
                  onPress={setAccountPassword}
                  disabled={sending}
                  style={[styles.secondaryWide, sending && { opacity: 0.5 }]}
                >
                  <Text style={styles.secondaryText}>
                    {sending ? "Please wait..." : "Save new password"}
                  </Text>
                </Pressable>
              </>
            ) : (
              <View style={styles.accountStatusCard}>
                <Text style={styles.accountStatusTitle}>✓ Signed in</Text>
                <Text style={styles.accountStatusText}>
                  Your account and rounds are available on this device.
                </Text>
              </View>
            )}
          </>
        ) : cloudConfigured ? (
          <>
            <View style={styles.authTabs}>
              <Pressable
                onPress={() => {
                  setAuthMode("signin");
                  setMessage("");
                }}
                style={[
                  styles.authTab,
                  authMode === "signin" && styles.authTabActive,
                ]}
              >
                <Text style={styles.authTabText}>Sign in</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  setAuthMode("signup");
                  setMessage("");
                }}
                style={[
                  styles.authTab,
                  authMode === "signup" && styles.authTabActive,
                ]}
              >
                <Text style={styles.authTabText}>Create account</Text>
              </Pressable>
            </View>
            <Text style={styles.intro}>
              {authMode === "signin"
                ? "Enter your email and password. After signing in you return directly to Home."
                : "Create your account and confirm your email once. Then use the Sign in tab."}
            </Text>
            <Text style={styles.inputLabel}>Email address</Text>
            <TextInput
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="you@example.com"
              placeholderTextColor="#64776a"
              style={styles.nameInput}
            />
            <Text style={styles.inputLabel}>Password</Text>
            <TextInput
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              placeholder="Password · at least 6 characters"
              placeholderTextColor="#64776a"
              style={styles.nameInput}
            />
            {authMode === "signup" ? (
              <>
                <Text style={styles.inputLabel}>Confirm password</Text>
                <TextInput
                  value={signupConfirm}
                  onChangeText={setSignupConfirm}
                  secureTextEntry
                  autoCapitalize="none"
                  placeholder="Enter password again"
                  placeholderTextColor="#64776a"
                  style={styles.nameInput}
                />
              </>
            ) : null}
            <Pressable
              disabled={sending}
              onPress={() => passwordAuth(authMode === "signup")}
              style={[styles.start, sending && { opacity: 0.5 }]}
            >
              <Text style={styles.startText}>
                {sending
                  ? "Please wait..."
                  : authMode === "signin"
                    ? "Sign in and go to Home"
                    : "Create account"}
              </Text>
            </Pressable>
            {authMode === "signin" ? (
              <Pressable disabled={sending} onPress={() => sendPasswordReset()}>
                <Text style={styles.magicFallback}>Forgot or set password</Text>
              </Pressable>
            ) : null}
          </>
        ) : (
          <Text style={styles.intro}>
            Account login will become active after the Supabase Project URL and
            publishable key are added to Netlify.
          </Text>
        )}
        {message ? <Text style={styles.gpsMessage}>{message}</Text> : null}
        <Text style={styles.sectionLabel}>PLAYER PROFILE ON THIS DEVICE</Text>
        <Text style={styles.inputLabel}>Username / display name</Text>
        <TextInput
          value={nameDraft}
          onChangeText={setNameDraft}
          autoCapitalize="words"
          maxLength={30}
          placeholder="Your name"
          placeholderTextColor="#64776a"
          style={styles.nameInput}
        />
        <Text style={styles.inputLabel}>
          Handicap Index (-5 to 54 · use a minus for a plus handicap)
        </Text>
        <HandicapInput value={handicapDraft} onChange={setHandicapDraft} />
        <Pressable onPress={saveLocalProfile} style={styles.secondaryWide}>
          <Text style={styles.secondaryText}>Save player profile</Text>
        </Pressable>
        <Text style={styles.sectionLabel}>PAST ROUNDS</Text>
        {historyLoading ? (
          <ActivityIndicator color="#d8ff70" />
        ) : history.length ? (
          history.map((round) => {
            const played = Math.max(
              0,
              ...round.players.map(
                (player) =>
                  player.scores.filter((score) => score !== null).length,
              ),
            );
            return (
              <View key={round.id} style={styles.historyCard}>
                <Pressable
                  onPress={() => setSelectedRound(round)}
                  style={{ flex: 1 }}
                >
                  <Text style={styles.historyCourse}>
                    {courses[round.course_id]?.shortName ?? round.course_id}
                  </Text>
                  <Text style={styles.historyMeta}>
                    {new Date(round.played_at).toLocaleDateString()} ·{" "}
                    {round.format.toUpperCase()} · {played}/18 holes
                  </Text>
                  <Text style={styles.continueText}>View scorecard ›</Text>
                </Pressable>
                {pendingHistoryDelete === round.id ? (
                  <View style={styles.deleteConfirm}>
                    <Text style={styles.historyMeta}>Delete permanently?</Text>
                    <Pressable onPress={() => deletePastRound(round)}>
                      <Text style={styles.deleteYes}>Yes, delete</Text>
                    </Pressable>
                    <Pressable onPress={() => setPendingHistoryDelete(null)}>
                      <Text style={styles.secondaryText}>Cancel</Text>
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setPendingHistoryDelete(round.id)}>
                    <Text style={styles.remove}>Delete</Text>
                  </Pressable>
                )}
              </View>
            );
          })
        ) : (
          <Text style={styles.intro}>Finished rounds will appear here.</Text>
        )}
        {session && (
          <Pressable onPress={signOut} style={styles.secondaryWide}>
            <Text style={styles.secondaryText}>Sign out</Text>
          </Pressable>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function PastRoundDetail({
  round,
  onBack,
}: {
  round: PastRound;
  onBack: () => void;
}) {
  const course = courses[round.course_id];
  const ratings = round.players.map(
    (player) =>
      course.teeRatings[player.gender].find(
        (rating) => rating.color === player.teeColor,
      ) ?? course.teeRatings[player.gender][0]!,
  );
  const courseHandicaps = round.players.map((player, index) =>
    courseHandicap(player.handicapIndex, ratings[index]!, course.par),
  );
  const playingHandicaps =
    round.format === "stableford"
      ? courseHandicaps
      : relativePlayingHandicaps(courseHandicaps);
  const holePoints = (playerIndex: number, holeIndex: number) => {
    const hole = course.holes[holeIndex]!;
    const strokes = allocatedStrokes(
      playingHandicaps[playerIndex] ?? 0,
      playerStrokeIndex(hole, round.players[playerIndex]!),
    );
    const gross = round.players[playerIndex]!.scores[holeIndex] ?? null;
    if (round.format === "stableford") return stableford(gross, hole, strokes);
    const grossAll = round.players.map(
      (player) => player.scores[holeIndex] ?? null,
    );
    const strokeAll = round.players.map((_, index) =>
      allocatedStrokes(
        playingHandicaps[index] ?? 0,
        playerStrokeIndex(hole, round.players[index]!),
      ),
    );
    const net = netScores(grossAll, strokeAll);
    if (round.format === "amerikaantje")
      return amerikaantjePoints(net)?.[playerIndex] ?? null;
    if (round.format === "matchplay2v2" || round.format === "fourball") {
      const winner = teamMatchPlayHole(net, round.format === "fourball");
      const team = playerIndex < 2 ? 0 : 1;
      return winner === team
        ? 1
        : winner === -1
          ? 0.5
          : winner === null
            ? null
            : 0;
    }
    const winner = matchPlayHole(net);
    return winner === playerIndex
      ? 1
      : winner === -1
        ? 0.5
        : winner === null
          ? null
          : 0;
  };
  const totals = round.players.map((_, playerIndex) =>
    course.holes.reduce(
      (total, __, holeIndex) =>
        total + (holePoints(playerIndex, holeIndex) ?? 0),
      0,
    ),
  );
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.accountPage}>
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹ Past rounds</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{round.format.toUpperCase()}</Text>
        <Text style={styles.setupTitle}>
          {course?.shortName ?? round.course_id}
        </Text>
        <Text style={styles.intro}>
          {new Date(round.played_at).toLocaleString()}
        </Text>
        <Scorecard
          course={course}
          format={round.format}
          players={round.players}
          playingHandicaps={playingHandicaps}
          totals={totals}
        />
      </ScrollView>
    </SafeAreaView>
  );
}

function SetupScreen({
  course,
  format,
  players,
  ratings,
  courseHandicaps,
  error,
  onBack,
  onFormat,
  onPlayer,
  onGender,
  onAdd,
  onRemove,
  onStart,
  shared,
}: any) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView
        contentContainerStyle={styles.setup}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable onPress={onBack}>
          <Text style={styles.back}>‹ Back to courses</Text>
        </Pressable>
        <Text style={styles.eyebrow}>{course.shortName.toUpperCase()}</Text>
        <Text style={styles.setupTitle}>
          {shared ? "Set up shared live game" : "Set up the game"}
        </Text>
        <Text style={styles.sectionLabel}>FORMAT</Text>
        <View style={styles.formatRow}>
          {(
            [
              ["stableford", "Stableford"],
              ["matchplay", "1v1 Match Play"],
              ["matchplay2v2", "2v2 Match Play"],
              ["fourball", "Four Ball Best Ball"],
              ["amerikaantje", "Amerikaantje"],
            ] as const
          ).map(([value, label]) => (
            <Pressable
              key={value}
              onPress={() => onFormat(value)}
              style={[styles.formatButton, format === value && styles.selected]}
            >
              <Text style={styles.formatText}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {players.map((player: Player, index: number) => {
          const tees = course.teeRatings[player.gender];
          return (
            <View key={player.id} style={styles.playerSetup}>
              <View style={styles.setupPlayerTop}>
                <Text style={styles.playerNumber}>
                  {format === "matchplay2v2" || format === "fourball"
                    ? `TEAM ${index < 2 ? "A" : "B"} · PLAYER ${index + 1}`
                    : `PLAYER ${index + 1}`}
                </Text>
                {format === "stableford" && players.length > 1 && (
                  <Pressable onPress={() => onRemove(index)}>
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                )}
              </View>
              <TextInput
                value={player.name}
                onChangeText={(name) => onPlayer(index, { name })}
                style={styles.nameInput}
                placeholder="Name"
                placeholderTextColor="#64776a"
              />
              <View style={styles.genderRow}>
                {(["men", "women"] as Gender[]).map((gender) => (
                  <Pressable
                    key={gender}
                    onPress={() => onGender(index, gender)}
                    style={[
                      styles.smallChoice,
                      player.gender === gender && styles.selected,
                    ]}
                  >
                    <Text style={styles.choiceText}>
                      {gender === "men" ? "Men" : "Women"}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.sectionLabel}>HANDICAP INDEX</Text>
              <HandicapInput
                value={player.handicapIndex}
                onChange={(handicapIndex) => onPlayer(index, { handicapIndex })}
              />
              <Text style={styles.sectionLabel}>TEE</Text>
              <View style={styles.teeRow}>
                {tees.map((tee: any) => (
                  <Pressable
                    key={tee.color}
                    onPress={() => onPlayer(index, { teeColor: tee.color })}
                    style={[
                      styles.teeButton,
                      player.teeColor === tee.color && styles.selected,
                    ]}
                  >
                    <View
                      style={[
                        styles.teeDot,
                        { backgroundColor: teeColors[tee.color as TeeColor] },
                      ]}
                    />
                    <Text style={styles.teeText}>{tee.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.chResult}>
                Course Handicap {courseHandicaps[index]} · CR{" "}
                {ratings[index].courseRating} · Slope {ratings[index].slope}
              </Text>
            </View>
          );
        })}
        {format === "stableford" && players.length < 4 && (
          <Pressable onPress={onAdd} style={styles.addPlayer}>
            <Text style={styles.addText}>+ Add player</Text>
          </Pressable>
        )}
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Pressable onPress={onStart} style={styles.start}>
          <Text style={styles.startText}>
            {shared ? "Create live round & join code" : "Start game"}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function HandicapInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}) {
  const [text, setText] = useState(String(value).replace(".", ","));
  function change(next: string) {
    if (!/^-?\d{0,2}([,.]\d{0,1})?$/.test(next)) return;
    setText(next);
    if (next && !/[,.]$/.test(next)) {
      const parsed = Number(next.replace(",", "."));
      if (Number.isFinite(parsed) && parsed >= -5 && parsed <= 54)
        onChange(parsed);
    }
  }
  function finish() {
    const parsed = Number(text.replace(",", "."));
    const valid = Number.isFinite(parsed)
      ? Math.max(-5, Math.min(54, parsed))
      : value;
    onChange(valid);
    setText(String(valid).replace(".", ","));
  }
  return (
    <TextInput
      value={text}
      onChangeText={change}
      onBlur={finish}
      keyboardType="decimal-pad"
      inputMode="decimal"
      style={styles.hcpInput}
    />
  );
}

function ResumeScreen({
  courseName,
  completed,
  players,
  totals,
  onContinue,
  onDiscard,
}: any) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <View style={styles.resume}>
        <Text style={styles.eyebrow}>SAVED GAME</Text>
        <Text style={styles.setupTitle}>Continue playing?</Text>
        <Text style={styles.intro}>
          {courseName} · {completed}/18 holes
        </Text>
        <View style={styles.resumeCard}>
          {players.map((player: Player, index: number) => (
            <View key={player.id} style={styles.resumeRow}>
              <Text style={styles.playerName}>{player.name}</Text>
              <Text style={styles.resumePoints}>{totals[index]} pts</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={onContinue} style={styles.start}>
          <Text style={styles.startText}>Continue game</Text>
        </Pressable>
        <Pressable onPress={onDiscard} style={styles.secondaryWide}>
          <Text style={styles.secondaryText}>Discard and return home</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

function Scorecard({ course, format, players, playingHandicaps, totals }: any) {
  return (
    <View>
      <Text style={styles.scorecardHelp}>
        Gross score / game points · ★ = stroke received · +1 = stroke given back
        by a plus handicap · totals update after every completed hole
      </Text>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View>
          <View style={styles.tableRow}>
            <Text style={[styles.tableName, styles.tableHeader]}>PLAYER</Text>
            {course.holes.map((hole: Hole) => (
              <Text
                key={hole.number}
                style={[styles.tableCell, styles.tableHeader]}
              >
                {hole.number}
              </Text>
            ))}
            <Text style={[styles.tableTotal, styles.tableHeader]}>TOTAL</Text>
          </View>
          {players.map((player: Player, pIndex: number) => (
            <View key={player.id} style={styles.tableRow}>
              <View style={styles.tableName}>
                <Text style={styles.tablePlayer}>{player.name}</Text>
                <Text style={styles.tableSub}>
                  PH {playingHandicaps[pIndex]}
                </Text>
              </View>
              {course.holes.map((hole: Hole, hIndex: number) => {
                const gross = player.scores[hIndex] ?? null;
                const strokes = allocatedStrokes(
                  playingHandicaps[pIndex] ?? 0,
                  playerStrokeIndex(hole, player),
                );
                const grossAll = players.map(
                  (p: Player) => p.scores[hIndex] ?? null,
                );
                const strokeAll = players.map((_: Player, i: number) =>
                  allocatedStrokes(
                    playingHandicaps[i] ?? 0,
                    playerStrokeIndex(hole, players[i]!),
                  ),
                );
                const net = netScores(grossAll, strokeAll);
                let pts: any =
                  format === "stableford"
                    ? stableford(gross, hole, strokes)
                    : format === "amerikaantje"
                      ? (amerikaantjePoints(net)?.[pIndex] ?? null)
                      : format === "matchplay2v2" || format === "fourball"
                        ? (() => {
                            const winner = teamMatchPlayHole(
                              net,
                              format === "fourball",
                            );
                            const team = pIndex < 2 ? 0 : 1;
                            return winner === team
                              ? 1
                              : winner === -1
                                ? 0.5
                                : winner === null
                                  ? null
                                  : 0;
                          })()
                        : (() => {
                            const w = matchPlayHole(net);
                            return w === pIndex
                              ? 1
                              : w === -1
                                ? 0.5
                                : w === null
                                  ? null
                                  : 0;
                          })();
                return (
                  <View key={hole.number} style={styles.tableCell}>
                    <Text style={styles.cellGross}>{gross ?? "–"}</Text>
                    <Text style={styles.cellStrokes}>
                      {strokes >= 0
                        ? "★".repeat(strokes)
                        : `+${Math.abs(strokes)}`}
                    </Text>
                    <Text style={styles.cellPoints}>
                      {pts === null ? "" : pts}
                    </Text>
                  </View>
                );
              })}
              <View style={styles.tableTotal}>
                <Text style={styles.totalScore}>{totals[pIndex]}</Text>
                <Text style={styles.tableSub}>
                  {format === "matchplay" ||
                  format === "matchplay2v2" ||
                  format === "fourball"
                    ? "wins"
                    : "pts"}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const teeColors: Record<TeeColor, string> = {
  white: "#f3f3ee",
  yellow: "#f3cf45",
  blue: "#67a9ff",
  red: "#ff6f65",
  orange: "#ff9f43",
};

const historyStyles = {
  historyCard: {
    backgroundColor: "#0d2418",
    borderRadius: 15,
    padding: 15,
    marginBottom: 8,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
  },
  historyCourse: { color: "#f5f8f2", fontSize: 15, fontWeight: "900" as const },
  historyMeta: { color: "#7d9184", fontSize: 10, marginTop: 4 },
  historyArrow: { color: "#d8ff70", fontSize: 27 },
  historyPlayer: {
    backgroundColor: "#0d2418",
    borderRadius: 17,
    padding: 14,
    marginBottom: 10,
  },
  historyPlayerTop: {
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    marginBottom: 12,
  },
  historyHoles: { flexDirection: "row" as const },
  historyHole: {
    width: 43,
    alignItems: "center" as const,
    paddingVertical: 7,
    borderRightWidth: 1,
    borderRightColor: "#23402c",
  },
  startedCard: {
    backgroundColor: "#183424",
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: "#49684f",
  },
  sharedRoundCard: {
    backgroundColor: "#183424",
    borderRadius: 18,
    padding: 16,
    marginBottom: 10,
    flexDirection: "row" as const,
    justifyContent: "space-between" as const,
    alignItems: "center" as const,
    borderWidth: 1,
    borderColor: "#d8ff70",
  },
  sharedRoundText: {
    color: "#a8baad",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  sharedBanner: {
    backgroundColor: "#2b3f1d",
    borderRadius: 15,
    padding: 14,
    marginBottom: 18,
    borderWidth: 1,
    borderColor: "#d8ff70",
  },
  sharedBannerTitle: {
    color: "#d8ff70",
    fontSize: 13,
    fontWeight: "900" as const,
  },
  sharedJoinRow: {
    flexDirection: "row" as const,
    alignItems: "center" as const,
    gap: 9,
    marginTop: 9,
  },
  sharedCode: {
    color: "#d8ff70",
    fontSize: 11,
    fontWeight: "900" as const,
    marginTop: 4,
  },
  startedTitle: {
    color: "#f5f8f2",
    fontSize: 20,
    fontWeight: "900" as const,
    marginTop: 3,
  },
  startedRound: {
    backgroundColor: "#0d2418",
    borderRadius: 17,
    padding: 16,
    marginBottom: 9,
    flexDirection: "row" as const,
    gap: 12,
    alignItems: "flex-start" as const,
  },
  continueText: {
    color: "#d8ff70",
    fontSize: 11,
    fontWeight: "900" as const,
    marginTop: 9,
  },
  deleteConfirm: { alignItems: "flex-end" as const, gap: 8 },
  deleteYes: { color: "#ff8f82", fontSize: 11, fontWeight: "900" as const },
};

const styles = StyleSheet.create({
  ...historyStyles,
  safe: { flex: 1, backgroundColor: "#071710" },
  container: { padding: 20, paddingTop: 32, paddingBottom: 38 },
  setup: { padding: 24, paddingTop: 55, paddingBottom: 45 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 20,
  },
  eyebrow: {
    color: "#d8ff70",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.8,
  },
  title: { color: "#f5f8f2", fontSize: 28, fontWeight: "900", marginTop: 3 },
  liveText: { color: "#80dc96", fontSize: 10, fontWeight: "900" },
  setupTitle: {
    color: "#f5f8f2",
    fontSize: 34,
    lineHeight: 40,
    fontWeight: "900",
    marginTop: 8,
  },
  intro: {
    color: "#91a499",
    fontSize: 14,
    lineHeight: 21,
    marginTop: 9,
    marginBottom: 24,
  },
  courseCard: {
    backgroundColor: "#0d2418",
    borderRadius: 18,
    padding: 17,
    borderWidth: 1,
    borderColor: "#20402b",
  },
  courseTop: { flexDirection: "row", justifyContent: "space-between" },
  flag: { fontSize: 21 },
  coursePar: { color: "#d8ff70", fontSize: 10, fontWeight: "900" },
  courseName: {
    color: "#f4f7f1",
    fontSize: 18,
    fontWeight: "900",
    marginTop: 8,
  },
  courseLocation: { color: "#718578", fontSize: 11, marginTop: 3 },
  back: { color: "#d8ff70", fontWeight: "800", marginBottom: 22 },
  sectionLabel: {
    color: "#82988a",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.3,
    marginTop: 13,
    marginBottom: 7,
  },
  inputLabel: {
    color: "#b9c9bd",
    fontSize: 11,
    fontWeight: "800",
    marginTop: 12,
    marginBottom: 4,
  },
  authTabs: {
    flexDirection: "row",
    backgroundColor: "#0c2116",
    borderRadius: 14,
    padding: 4,
    gap: 4,
    marginTop: 18,
  },
  authTab: {
    flex: 1,
    paddingVertical: 13,
    alignItems: "center",
    borderRadius: 11,
    borderWidth: 1,
    borderColor: "transparent",
  },
  authTabActive: {
    backgroundColor: "#254832",
    borderColor: "#d8ff70",
  },
  authTabText: { color: "#f1f5ef", fontSize: 12, fontWeight: "900" },
  formatRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginBottom: 15,
  },
  formatButton: {
    flexGrow: 1,
    flexBasis: "30%",
    backgroundColor: "#0c2116",
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#1e3b29",
    alignItems: "center",
  },
  formatText: { color: "#e6ede7", fontSize: 11, fontWeight: "800" },
  selected: { borderColor: "#d8ff70", backgroundColor: "#1a3a27" },
  playerSetup: {
    backgroundColor: "#0c2116",
    borderRadius: 19,
    padding: 16,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "#1d3b28",
  },
  setupPlayerTop: { flexDirection: "row", justifyContent: "space-between" },
  playerNumber: {
    color: "#d8ff70",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.3,
  },
  remove: { color: "#ff8f82", fontSize: 11 },
  nameInput: {
    backgroundColor: "#07170f",
    color: "#f5f8f2",
    fontSize: 19,
    fontWeight: "800",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#52745d",
    padding: 12,
    marginTop: 11,
  },
  genderRow: { flexDirection: "row", gap: 7, marginTop: 9 },
  smallChoice: {
    flex: 1,
    alignItems: "center",
    padding: 10,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#24432e",
  },
  choiceText: { color: "#e4ece6", fontWeight: "700" },
  hcpInput: {
    backgroundColor: "#07170f",
    color: "#f5f8f2",
    fontSize: 25,
    fontWeight: "900",
    borderRadius: 12,
    borderWidth: 2,
    borderColor: "#d8ff70",
    padding: 11,
  },
  teeRow: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  teeButton: {
    minWidth: 62,
    alignItems: "center",
    padding: 9,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#24432e",
  },
  teeDot: { width: 8, height: 8, borderRadius: 4, marginBottom: 4 },
  teeText: { color: "#e4ece6", fontSize: 10, fontWeight: "800" },
  chResult: { color: "#9cb0a2", fontSize: 11, marginTop: 13 },
  addPlayer: {
    borderWidth: 1,
    borderColor: "#41614a",
    borderRadius: 15,
    padding: 14,
    alignItems: "center",
    marginTop: 12,
  },
  addText: { color: "#d8ff70", fontWeight: "800" },
  error: { color: "#ff968b", textAlign: "center", marginTop: 12 },
  start: {
    backgroundColor: "#d8ff70",
    borderRadius: 17,
    padding: 17,
    alignItems: "center",
    marginTop: 16,
  },
  startText: { color: "#102015", fontWeight: "900", fontSize: 15 },
  distanceCard: {
    backgroundColor: "#10291b",
    borderRadius: 24,
    padding: 20,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "#1b402b",
  },
  label: {
    color: "#93aa99",
    fontSize: 10,
    fontWeight: "900",
    letterSpacing: 1.4,
  },
  distanceRow: { flexDirection: "row", alignItems: "baseline" },
  distance: {
    color: "#f7faef",
    fontSize: 82,
    lineHeight: 92,
    fontWeight: "900",
  },
  unit: { color: "#d8ff70", fontSize: 18, fontWeight: "800", marginLeft: 7 },
  greenSource: {
    color: "#78917f",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1,
  },
  noDistance: { color: "#b2c0b6", paddingVertical: 45, textAlign: "center" },
  gpsRetry: {
    borderWidth: 1,
    borderColor: "#d8ff70",
    borderRadius: 12,
    paddingVertical: 11,
    paddingHorizontal: 18,
    marginTop: -25,
    marginBottom: 20,
  },
  gpsRetryText: { color: "#d8ff70", fontSize: 11, fontWeight: "900" },
  holeNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginVertical: 20,
  },
  navButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1,
    borderColor: "#34533e",
    alignItems: "center",
    justifyContent: "center",
  },
  navText: { color: "#fff", fontSize: 36, lineHeight: 40 },
  holeBig: { color: "#fff", fontSize: 48, lineHeight: 51, fontWeight: "900" },
  par: { color: "#d8ff70", fontSize: 11, fontWeight: "800" },
  holeResult: {
    backgroundColor: "#0c2116",
    borderRadius: 13,
    padding: 12,
    marginBottom: 10,
  },
  holeResultText: {
    color: "#cbd8ce",
    fontSize: 12,
    textAlign: "center",
    fontWeight: "700",
  },
  playerScore: {
    backgroundColor: "#10291b",
    borderRadius: 20,
    padding: 16,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: "#1c402b",
  },
  playerScoreTop: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  playerName: { color: "#f6f8f2", fontSize: 16, fontWeight: "900" },
  playerMeta: { color: "#829689", fontSize: 10, marginTop: 3 },
  pointBadge: {
    backgroundColor: "#07170f",
    borderRadius: 11,
    paddingHorizontal: 11,
    paddingVertical: 6,
    alignItems: "center",
  },
  pointNumber: { color: "#d8ff70", fontSize: 20, fontWeight: "900" },
  pointLabel: { color: "#75877b", fontSize: 8, fontWeight: "900" },
  counter: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: 15,
  },
  counterButton: {
    width: 53,
    height: 53,
    borderRadius: 27,
    backgroundColor: "#d8ff70",
    alignItems: "center",
    justifyContent: "center",
  },
  counterText: {
    fontSize: 30,
    lineHeight: 34,
    color: "#102015",
    fontWeight: "700",
  },
  scoreNumber: {
    color: "#fff",
    fontSize: 47,
    lineHeight: 52,
    fontWeight: "900",
  },
  scoreCaption: {
    color: "#75897b",
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 1,
  },
  clear: {
    color: "#7c9182",
    fontSize: 10,
    textAlign: "center",
    textDecorationLine: "underline",
    marginTop: 10,
  },
  calibrate: {
    borderWidth: 1,
    borderColor: "#3d6048",
    borderRadius: 14,
    padding: 13,
    alignItems: "center",
    marginTop: 4,
  },
  calibrateText: { color: "#a9beaF", fontWeight: "800", fontSize: 11 },
  gpsMessage: {
    color: "#91a598",
    fontSize: 10,
    textAlign: "center",
    marginTop: 7,
  },
  bottomNav: {
    flexDirection: "row",
    backgroundColor: "#0b2015",
    borderRadius: 16,
    padding: 5,
    marginTop: 22,
    gap: 4,
  },
  bottomButton: {
    flex: 1,
    alignItems: "center",
    paddingVertical: 12,
    borderRadius: 12,
  },
  bottomActive: { backgroundColor: "#24462f" },
  bottomText: { color: "#dce5de", fontSize: 10, fontWeight: "900" },
  confirm: {
    backgroundColor: "#2b1b17",
    borderRadius: 18,
    padding: 16,
    marginTop: 13,
    borderWidth: 1,
    borderColor: "#684238",
  },
  confirmTitle: { color: "#fff", fontSize: 17, fontWeight: "900" },
  confirmBody: { color: "#c7aaa2", fontSize: 11, marginTop: 4 },
  confirmRow: { flexDirection: "row", gap: 8, marginTop: 13 },
  secondary: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#765149",
    padding: 12,
    borderRadius: 11,
    alignItems: "center",
  },
  secondaryText: { color: "#dce6de", fontWeight: "800", fontSize: 11 },
  danger: {
    flex: 1,
    backgroundColor: "#ff806f",
    padding: 12,
    borderRadius: 11,
    alignItems: "center",
  },
  dangerText: { color: "#2b1512", fontWeight: "900", fontSize: 11 },
  resume: { flex: 1, justifyContent: "center", padding: 24 },
  resumeCard: {
    backgroundColor: "#0c2116",
    borderRadius: 18,
    padding: 16,
    marginTop: 5,
  },
  resumeRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 7,
  },
  resumePoints: { color: "#d8ff70", fontWeight: "900" },
  secondaryWide: {
    borderWidth: 1,
    borderColor: "#3f5d48",
    borderRadius: 17,
    padding: 16,
    alignItems: "center",
    marginTop: 10,
  },
  magicFallback: {
    color: "#d8ff70",
    fontSize: 12,
    fontWeight: "800",
    textAlign: "center",
    textDecorationLine: "underline",
    paddingVertical: 16,
  },
  scorecardHelp: {
    color: "#8da094",
    fontSize: 11,
    lineHeight: 17,
    marginBottom: 13,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1c3525",
    minHeight: 56,
    alignItems: "stretch",
  },
  tableName: {
    width: 115,
    padding: 8,
    justifyContent: "center",
    backgroundColor: "#0c2116",
  },
  tableCell: {
    width: 43,
    padding: 4,
    alignItems: "center",
    justifyContent: "center",
    borderLeftWidth: 1,
    borderLeftColor: "#193323",
  },
  tableTotal: {
    width: 64,
    padding: 5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#173423",
  },
  tableHeader: { color: "#91a499", fontSize: 9, fontWeight: "900" },
  tablePlayer: { color: "#f2f6f2", fontSize: 12, fontWeight: "900" },
  tableSub: { color: "#74887b", fontSize: 8, marginTop: 2 },
  cellGross: { color: "#f3f6f2", fontSize: 13, fontWeight: "800" },
  cellStrokes: {
    color: "#ffcf4a",
    fontSize: 7,
    lineHeight: 9,
    fontWeight: "900",
    minHeight: 9,
  },
  cellPoints: { color: "#d8ff70", fontSize: 9, fontWeight: "900" },
  totalScore: { color: "#d8ff70", fontSize: 19, fontWeight: "900" },
  accountBar: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  accountState: { color: "#718578", fontSize: 9, marginTop: 4 },
  accountButton: {
    maxWidth: 145,
    borderWidth: 1,
    borderColor: "#42624c",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  accountButtonText: { color: "#d8ff70", fontSize: 10, fontWeight: "800" },
  accountPage: {
    flexGrow: 1,
    width: "100%",
    maxWidth: 760,
    alignSelf: "center",
    justifyContent: "flex-start",
    padding: 24,
    paddingBottom: 120,
  },
  accountStatusCard: {
    backgroundColor: "#10291b",
    borderWidth: 1,
    borderColor: "#31583c",
    borderRadius: 16,
    padding: 16,
    marginBottom: 12,
  },
  accountStatusTitle: { color: "#d8ff70", fontSize: 14, fontWeight: "900" },
  accountStatusText: { color: "#91a499", fontSize: 11, marginTop: 5 },
  locationCard: {
    backgroundColor: "#10291b",
    borderWidth: 1,
    borderColor: "#31583c",
    borderRadius: 18,
    padding: 16,
    marginBottom: 24,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  locationTitle: {
    color: "#f4f7f1",
    fontSize: 17,
    fontWeight: "900",
    marginTop: 4,
  },
  locationText: {
    color: "#91a499",
    fontSize: 10,
    lineHeight: 15,
    marginTop: 4,
  },
  locationButton: {
    backgroundColor: "#d8ff70",
    borderRadius: 12,
    paddingHorizontal: 15,
    paddingVertical: 12,
  },
  locationButtonText: { color: "#102015", fontSize: 11, fontWeight: "900" },
  ryderCard: {
    backgroundColor: "#d8ff70",
    borderRadius: 20,
    padding: 18,
    marginBottom: 24,
  },
  ryderKicker: {
    color: "#35511c",
    fontSize: 9,
    fontWeight: "900",
    letterSpacing: 1.2,
  },
  ryderTitle: {
    color: "#102015",
    fontSize: 24,
    fontWeight: "900",
    marginTop: 4,
  },
  ryderText: { color: "#385128", fontSize: 11, lineHeight: 16, marginTop: 4 },
});
