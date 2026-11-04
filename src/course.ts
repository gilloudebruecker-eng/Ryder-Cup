export type GreenPoint = { latitude: number; longitude: number };
export type Gender = "men" | "women";
export type TeeColor = "white" | "yellow" | "blue" | "red" | "orange";
export type CourseId =
  "keerbergen" | "oostburg" | "zoute-championship" | "zoute-executive";

export type TeeRating = {
  color: TeeColor;
  label: string;
  courseRating: number;
  slope: number;
};

export type Hole = {
  number: number;
  par: number;
  strokeIndex: number;
  womenStrokeIndex?: number;
  white: number;
  yellow: number;
  blue: number;
  red: number;
  orange?: number;
};

export type Course = {
  id: CourseId;
  name: string;
  shortName: string;
  location: string;
  par: number;
  center: GreenPoint;
  holes: Hole[];
  teeRatings: Record<Gender, TeeRating[]>;
  defaultGreens?: Record<number, GreenPoint>;
};

const rows = [
  [4, 10, 287, 277, 267, 257],
  [3, 16, 126, 114, 103, 92],
  [4, 2, 345, 339, 328, 316],
  [5, 4, 506, 491, 453, 453],
  [3, 18, 132, 126, 116, 106],
  [4, 6, 359, 347, 311, 292],
  [5, 8, 446, 422, 410, 394],
  [3, 14, 146, 136, 125, 125],
  [4, 12, 286, 286, 275, 275],
  [3, 15, 144, 132, 120, 94],
  [4, 3, 382, 361, 332, 324],
  [5, 13, 428, 417, 406, 368],
  [3, 9, 165, 159, 146, 135],
  [4, 7, 344, 344, 331, 311],
  [3, 17, 128, 118, 107, 95],
  [5, 11, 439, 416, 404, 372],
  [4, 1, 341, 331, 320, 320],
  [4, 5, 354, 353, 330, 318],
] as const;

const keerbergenHoles: Hole[] = rows.map((row, index) => ({
  number: index + 1,
  par: row[0],
  strokeIndex: row[1],
  white: row[2],
  yellow: row[3],
  blue: row[4],
  red: row[5],
}));

const KEERBERGEN_CENTER: GreenPoint = {
  latitude: 51.003009,
  longitude: 4.669168,
};
const keerbergenGreens: Record<number, GreenPoint> = {
  1: { latitude: 51.004812, longitude: 4.6730931 },
  2: { latitude: 51.0045862, longitude: 4.6744052 },
  3: { latitude: 51.0056765, longitude: 4.679454 },
  4: { latitude: 51.006439, longitude: 4.6861672 },
  5: { latitude: 51.0055501, longitude: 4.6867807 },
  6: { latitude: 51.0046161, longitude: 4.6821433 },
  7: { latitude: 51.0038582, longitude: 4.6760165 },
  8: { latitude: 51.0032681, longitude: 4.6751497 },
  9: { latitude: 51.0022172, longitude: 4.6715804 },
  10: { latitude: 51.0024626, longitude: 4.6706208 },
  11: { latitude: 51.0036508, longitude: 4.6751026 },
  12: { latitude: 51.0049953, longitude: 4.680582 },
  13: { latitude: 51.0056055, longitude: 4.6799391 },
  14: { latitude: 51.0046536, longitude: 4.6757571 },
  15: { latitude: 51.0047858, longitude: 4.6751253 },
  16: { latitude: 51.0031314, longitude: 4.6698624 },
  17: { latitude: 51.0011818, longitude: 4.6647509 },
  18: { latitude: 51.0031612, longitude: 4.6681709 },
};

const keerbergenRatings: Record<Gender, TeeRating[]> = {
  men: [
    { color: "white", label: "White", courseRating: 68.5, slope: 120 },
    { color: "yellow", label: "Yellow", courseRating: 67.7, slope: 115 },
    { color: "blue", label: "Blue", courseRating: 66.2, slope: 114 },
    { color: "red", label: "Red", courseRating: 65.2, slope: 112 },
  ],
  women: [
    { color: "yellow", label: "Yellow", courseRating: 72.4, slope: 127 },
    { color: "blue", label: "Blue", courseRating: 70.9, slope: 121 },
    { color: "red", label: "Red", courseRating: 69.9, slope: 116 },
  ],
};

const oostburgRows = [
  [3, 15, 176, 151, 154, 142],
  [5, 5, 529, 475, 501, 419],
  [3, 13, 197, 172, 175, 160],
  [4, 7, 419, 371, 384, 371],
  [4, 1, 434, 385, 372, 361],
  [5, 17, 493, 437, 414, 400],
  [4, 11, 339, 302, 287, 278],
  [3, 9, 209, 181, 160, 149],
  [5, 3, 589, 517, 477, 467],
  [4, 6, 463, 410, 402, 392],
  [4, 16, 386, 332, 318, 309],
  [3, 18, 149, 126, 126, 115],
  [4, 2, 441, 375, 362, 352],
  [5, 12, 525, 463, 444, 432],
  [3, 4, 173, 150, 156, 150],
  [4, 8, 394, 345, 329, 320],
  [5, 14, 460, 389, 376, 369],
  [5, 10, 626, 554, 538, 493],
] as const;

// The club's women's card uses a different stroke-allocation order.
const oostburgWomenStrokeIndexes = [
  15, 5, 7, 9, 1, 17, 13, 11, 3, 2, 16, 18, 6, 14, 10, 12, 8, 4,
] as const;

const oostburgHoles: Hole[] = oostburgRows.map((row, index) => ({
  number: index + 1,
  par: row[0],
  strokeIndex: row[1],
  white: row[2],
  yellow: row[3],
  blue: row[4],
  red: row[5],
  womenStrokeIndex: oostburgWomenStrokeIndexes[index],
}));

const oostburgRatings: Record<Gender, TeeRating[]> = {
  men: [
    { color: "white", label: "White", courseRating: 74.9, slope: 143 },
    { color: "yellow", label: "Yellow", courseRating: 74.0, slope: 139 },
    { color: "blue", label: "Blue", courseRating: 70.5, slope: 130 },
    { color: "red", label: "Red", courseRating: 69.4, slope: 125 },
    { color: "orange", label: "Orange", courseRating: 66.2, slope: 119 },
  ],
  women: [
    { color: "yellow", label: "Yellow", courseRating: 80.5, slope: 152 },
    { color: "blue", label: "Blue", courseRating: 76.6, slope: 142 },
    { color: "red", label: "Red", courseRating: 75.2, slope: 141 },
    { color: "orange", label: "Orange", courseRating: 71.6, slope: 129 },
  ],
};

const oostburgGreens: Record<number, GreenPoint> = {
  1: { latitude: 51.3234901, longitude: 3.460177 },
  2: { latitude: 51.3242126, longitude: 3.4547415 },
};

const zouteChampionshipRows = [
  [4, 3, 396, 377, 342, 333],
  [4, 11, 358, 340, 297, 271],
  [3, 17, 135, 122, 107, 100],
  [4, 9, 355, 340, 309, 301],
  [5, 15, 435, 415, 371, 341],
  [4, 1, 373, 363, 344, 290],
  [4, 7, 346, 320, 305, 285],
  [3, 13, 186, 160, 139, 120],
  [4, 5, 389, 367, 311, 271],
  [4, 8, 350, 338, 304, 274],
  [3, 16, 160, 151, 129, 119],
  [5, 18, 482, 470, 427, 367],
  [4, 2, 433, 409, 350, 303],
  [4, 6, 337, 322, 300, 270],
  [5, 12, 461, 431, 377, 340],
  [3, 14, 165, 145, 121, 105],
  [5, 10, 501, 465, 430, 393],
  [4, 4, 379, 345, 322, 312],
] as const;

const zouteChampionshipHoles: Hole[] = zouteChampionshipRows.map(
  (row, index) => ({
    number: index + 1,
    par: row[0],
    strokeIndex: row[1],
    white: row[2],
    yellow: row[3],
    blue: row[4],
    red: row[5],
  }),
);

const zouteChampionshipRatings: Record<Gender, TeeRating[]> = {
  men: [
    { color: "white", label: "Tee 63", courseRating: 73.4, slope: 131 },
    { color: "yellow", label: "Tee 58", courseRating: 70.6, slope: 130 },
    { color: "blue", label: "Tee 53", courseRating: 67.9, slope: 125 },
    { color: "red", label: "Tee 48", courseRating: 65.7, slope: 120 },
  ],
  women: [
    { color: "yellow", label: "Tee 58", courseRating: 76.9, slope: 134 },
    { color: "blue", label: "Tee 53", courseRating: 73.6, slope: 127 },
    { color: "red", label: "Tee 48", courseRating: 70.6, slope: 120 },
  ],
};

const zouteChampionshipGreens: Record<number, GreenPoint> = {
  1: { latitude: 51.3452522, longitude: 3.3103494 },
  2: { latitude: 51.342447, longitude: 3.3120371 },
  3: { latitude: 51.3427194, longitude: 3.310962 },
  4: { latitude: 51.340407, longitude: 3.3135789 },
  5: { latitude: 51.340828, longitude: 3.3081184 },
  6: { latitude: 51.341421, longitude: 3.3033218 },
  7: { latitude: 51.3419595, longitude: 3.2979504 },
  8: { latitude: 51.3428584, longitude: 3.2954584 },
  9: { latitude: 51.3442312, longitude: 3.2996819 },
  10: { latitude: 51.3436373, longitude: 3.2945736 },
  11: { latitude: 51.3436974, longitude: 3.2916448 },
  12: { latitude: 51.3476604, longitude: 3.2943114 },
  13: { latitude: 51.3448577, longitude: 3.2979272 },
  14: { latitude: 51.3471701, longitude: 3.2969135 },
  15: { latitude: 51.3492581, longitude: 3.3022424 },
  16: { latitude: 51.3482154, longitude: 3.3013504 },
  17: { latitude: 51.3435646, longitude: 3.3002746 },
  18: { latitude: 51.3427833, longitude: 3.305805 },
};

const zouteExecutiveRows = [
  [3, 11, 116, 109],
  [4, 5, 296, 261],
  [4, 1, 294, 286],
  [3, 9, 124, 114],
  [4, 15, 204, 191],
  [4, 3, 320, 283],
  [3, 17, 116, 103],
  [3, 7, 160, 140],
  [4, 13, 211, 200],
  [3, 14, 113, 106],
  [4, 2, 260, 245],
  [3, 8, 134, 124],
  [4, 18, 209, 186],
  [4, 6, 225, 195],
  [3, 16, 125, 120],
  [3, 12, 130, 109],
  [4, 10, 246, 233],
  [4, 4, 281, 256],
] as const;

const zouteExecutiveHoles: Hole[] = zouteExecutiveRows.map((row, index) => ({
  number: index + 1,
  par: row[0],
  strokeIndex: row[1],
  white: row[2],
  yellow: row[3],
  blue: row[3],
  red: row[3],
}));

const zouteExecutiveRatings: Record<Gender, TeeRating[]> = {
  men: [
    { color: "white", label: "Tee 36", courseRating: 58.7, slope: 94 },
    { color: "yellow", label: "Tee 33", courseRating: 57.2, slope: 91 },
  ],
  women: [
    { color: "white", label: "Tee 36", courseRating: 62.2, slope: 102 },
    { color: "yellow", label: "Tee 33", courseRating: 60.3, slope: 98 },
  ],
};

export const courses: Record<CourseId, Course> = {
  keerbergen: {
    id: "keerbergen",
    name: "Royal Keerbergen Golf Club",
    shortName: "Royal Keerbergen",
    location: "Keerbergen, Belgium",
    par: 70,
    center: KEERBERGEN_CENTER,
    holes: keerbergenHoles,
    teeRatings: keerbergenRatings,
    defaultGreens: keerbergenGreens,
  },
  oostburg: {
    id: "oostburg",
    name: "Golfclub Oostburg – De Brugse Vaart",
    shortName: "Golfclub Oostburg",
    location: "Oostburg, Netherlands",
    par: 73,
    center: { latitude: 51.32439, longitude: 3.46328 },
    holes: oostburgHoles,
    teeRatings: oostburgRatings,
    defaultGreens: oostburgGreens,
  },
  "zoute-championship": {
    id: "zoute-championship",
    name: "Royal Zoute Golf Club - Championship Course",
    shortName: "Royal Zoute Championship",
    location: "Knokke-Heist, Belgium",
    par: 72,
    center: { latitude: 51.34487, longitude: 3.3026 },
    holes: zouteChampionshipHoles,
    teeRatings: zouteChampionshipRatings,
    defaultGreens: zouteChampionshipGreens,
  },
  "zoute-executive": {
    id: "zoute-executive",
    name: "Royal Zoute Golf Club - Executive Course",
    shortName: "Royal Zoute Executive",
    location: "Knokke-Heist, Belgium",
    par: 64,
    center: { latitude: 51.34487, longitude: 3.3026 },
    holes: zouteExecutiveHoles,
    teeRatings: zouteExecutiveRatings,
  },
};
