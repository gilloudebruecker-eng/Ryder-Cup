# Keerbergen Golf GPS

Mobile web app for live GPS distances and multiplayer scoring at:

- Royal Keerbergen Golf Club
- Golfclub Oostburg - De Brugse Vaart
- Royal Zoute Championship Course
- Royal Zoute Executive Course

# Ryder Cup App

A web application for managing Ryder Cup-style golf competitions.

## Live Demo

[Try the Ryder Cup App](https://rydercup1.netlify.app)
## Set green centres

The club does not publish exact GPS coordinates for its greens. To avoid inaccurate estimates, this version provides one-time calibration for each hole:

1. Select the hole.
2. Walk to the centre of the green.
3. Wait until the displayed GPS accuracy is preferably 5 metres or better.
4. Tap **I am at the centre of the green**.

The position remains stored locally on the phone. The app will then show the live distance for that hole.

Public OpenStreetMap hole geometry is preloaded where complete and verifiable. 

## Players and game formats

At the start of a round, choose a course and game format. Add each player's name, gender, WHS Handicap Index and tee. These details are entered once and remain stored for the round.

- **Stableford** supports up to four players and calculates each player's Course Handicap and points.
- **Match Play** supports two players and allocates the handicap difference on the hardest holes according to stroke index.
- **Amerikaantje** supports exactly three players. Six points are divided per hole: 4/2/0, 4/1/1, 3/3/0 or 2/2/2 depending on ties.

Gross scores are entered for every player on every hole. The **Scorecard** tab shows completed holes, per-hole results and running totals. The active round is saved locally so it can be resumed after closing the app.

## Ryder Cup Live

The GPS-free Ryder Cup mode lets an authenticated organizer:

- choose between 1 and 12 players per team;
- enter both team names and every player name;
- choose a valid singles/doubles plan, such as two 2v2 matches plus one 1v1 match for a 5v5 event;
- select Scramble or Stableford for every matchup;
- share a six-character join code with participants.

Every matchup is scored as match play. A participant selects Team A, Halved or Team B for each hole. All authenticated members immediately see the updated ALL SQUARE / 1 UP / 2 UP status through Supabase Realtime and can correct results from their own phone. No GPS permission is used in this mode.

The recreational calculations use a 100% handicap allowance. A competition committee may set a different allowance for a specific event.
