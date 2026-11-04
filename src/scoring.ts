import type { Hole, TeeRating } from "./course";

/** WHS Course Handicap for an 18-hole round, rounded to the nearest integer. */
export function courseHandicap(
  handicapIndex: number,
  rating: TeeRating,
  coursePar: number,
): number {
  return Math.round(
    handicapIndex * (rating.slope / 113) + rating.courseRating - coursePar,
  );
}

/** Handicap strokes received on one hole, allocated by stroke index. */
export function strokesOnHole(
  playingHandicap: number,
  strokeIndex: number,
): number {
  if (playingHandicap < 0) {
    const plusHandicap = Math.abs(playingHandicap);
    const fullRounds = Math.floor(plusHandicap / 18);
    const remainder = plusHandicap % 18;
    return -(
      fullRounds + (remainder > 0 && strokeIndex > 18 - remainder ? 1 : 0)
    );
  }
  const fullRounds = Math.floor(playingHandicap / 18);
  const remainder = playingHandicap % 18;
  return fullRounds + (strokeIndex <= remainder ? 1 : 0);
}

/** Individual Stableford points: 1 for net bogey, 2 for net par, etc. */
export function stablefordPoints(
  grossScore: number | null,
  hole: Hole,
  strokes: number,
): number {
  if (grossScore === null) return 0;
  return Math.max(0, 2 + hole.par + strokes - grossScore);
}
