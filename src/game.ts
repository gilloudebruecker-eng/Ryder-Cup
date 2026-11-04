import type { Gender, Hole, TeeColor } from "./course";

export type GameFormat =
  "stableford" | "matchplay" | "matchplay2v2" | "fourball" | "amerikaantje";

export type Player = {
  id: string;
  name: string;
  gender: Gender;
  handicapIndex: number;
  teeColor: TeeColor;
  scores: (number | null)[];
};

export function relativePlayingHandicaps(courseHandicaps: number[]): number[] {
  const lowest = Math.min(...courseHandicaps);
  return courseHandicaps.map((value) => Math.max(0, value - lowest));
}

export function allocatedStrokes(
  handicap: number,
  strokeIndex: number,
): number {
  if (handicap === 0) return 0;
  if (handicap > 0)
    return Math.floor(handicap / 18) + (strokeIndex <= handicap % 18 ? 1 : 0);
  const plusHandicap = Math.abs(handicap);
  const fullRounds = Math.floor(plusHandicap / 18);
  const remainder = plusHandicap % 18;
  return -(
    fullRounds + (remainder > 0 && strokeIndex > 18 - remainder ? 1 : 0)
  );
}

export function stableford(
  gross: number | null,
  hole: Hole,
  strokes: number,
): number | null {
  if (gross === null) return null;
  return Math.max(0, 2 + hole.par + strokes - gross);
}

export function netScores(
  grossScores: (number | null)[],
  strokes: number[],
): (number | null)[] {
  return grossScores.map((score, index) =>
    score === null ? null : score - (strokes[index] ?? 0),
  );
}

export function amerikaantjePoints(net: (number | null)[]): number[] | null {
  if (net.length !== 3 || net.some((value) => value === null)) return null;
  const values = net as number[];
  const unique = [...new Set(values)].sort((a, b) => a - b);
  if (unique.length === 1) return [2, 2, 2];
  if (values.filter((value) => value === unique[0]).length === 2) {
    return values.map((value) => (value === unique[0] ? 3 : 0));
  }
  const winner = unique[0];
  const others = values.filter((value) => value !== winner);
  if (others[0] === others[1])
    return values.map((value) => (value === winner ? 4 : 1));
  const second = unique[1];
  return values.map((value) =>
    value === winner ? 4 : value === second ? 2 : 0,
  );
}

export function matchPlayHole(net: (number | null)[]): number | null {
  const first = net[0];
  const second = net[1];
  if (
    net.length !== 2 ||
    first === null ||
    first === undefined ||
    second === null ||
    second === undefined
  )
    return null;
  if (first === second) return -1;
  return first < second ? 0 : 1;
}

export function teamMatchPlayHole(
  net: (number | null)[],
  bestBall: boolean,
): number | null {
  if (net.length !== 4 || net.some((value) => value === null)) return null;
  const scores = net as number[];
  const teamA = bestBall
    ? Math.min(scores[0]!, scores[1]!)
    : scores[0]! + scores[1]!;
  const teamB = bestBall
    ? Math.min(scores[2]!, scores[3]!)
    : scores[2]! + scores[3]!;
  if (teamA === teamB) return -1;
  return teamA < teamB ? 0 : 1;
}
