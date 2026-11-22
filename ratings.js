// Psi Press rating engine.
//
// A faithful port of the "Elo", "Elo Calc", "Elo Players", "Elo Duos",
// "Tier Lists" and "Aura" tabs of the Master Sheet with Elo workbook.
// Pure functions only: the browser (app.js) and Node (verification scripts)
// both import this module.

export const RATING_SETTINGS = Object.freeze({
  start: 1000, // Starting rating (Elo!D5)
  k: 100, // Largest swing per game, also the hard cap (Elo!D6)
  evilAdvantage: 0, // Evil side advantage in Elo points (Elo!D7)
  scaleByTeamSize: true, // Zero-sum team-size weights (Elo!D8)
  provisionalGames: 5, // Below this, show the 95% range (Elo!D9)
  rd0: 150, // Starting uncertainty (Elo!D10)
  leaderboardMin: 3, // Leaderboard minimum games (Elo!D11)
  chessAverage: 1500, // Chess Elo of a player sitting on the start (Elo!D12)
  chessStretch: 3.96, // Chess Elo stretch (Elo!D13)
  chessTarget: 2850, // Target Chess Elo for #1, used for the suggestion (Elo!D14)
  minUnderdogGames: 3, // Upset list minimum (Tier Lists!D9)
  minDuoGames: 4, // Duo list minimum (Tier Lists!D10)
  rookieCount: 5,
});

// Elo!P5:Q15. Left value = Chess Elo needed for the title.
export const CHESS_TITLES = Object.freeze([
  [0, "Novice"],
  [1200, "Class D"],
  [1400, "Class C"],
  [1600, "Class B"],
  [1800, "Class A"],
  [2000, "Expert"],
  [2200, "CM"],
  [2300, "FM"],
  [2400, "IM"],
  [2500, "GM"],
  [2700, "Super GM"],
]);

export const TITLE_NAMES = Object.freeze({
  CM: "Candidate Master",
  FM: "FIDE Master",
  IM: "International Master",
  GM: "Grandmaster",
  "Super GM": "Super Grandmaster",
});

// Tier Lists!D6:H8. S if at or above the first cutoff, then A, B, C, D, else F.
export const TIER_CUTOFFS = Object.freeze({
  elo: [0.9, 0.7, 0.45, 0.25, 0.1],
  upset: [0.75, 0.6, 0.45, 0.3, 0.15],
  duo: [0.75, 0.6, 0.5, 0.35, 0.2],
});

const TIERS = ["S", "A", "B", "C", "D"];

export function tierFor(value, cutoffs) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  for (let index = 0; index < cutoffs.length; index += 1) {
    if (value >= cutoffs[index]) return TIERS[index];
  }
  return "F";
}

export function winProbability(goodAvg, evilAvg, evilAdvantage = RATING_SETTINGS.evilAdvantage) {
  return 1 / (1 + 10 ** ((evilAvg + evilAdvantage - goodAvg) / 400));
}

export function chessElo(baseElo, settings = RATING_SETTINGS) {
  return Math.max(100, settings.chessAverage + settings.chessStretch * (baseElo - settings.start));
}

export function chessTitle(chess) {
  let title = CHESS_TITLES[0][1];
  CHESS_TITLES.forEach(([cutoff, name]) => {
    if (chess >= cutoff) title = name;
  });
  return title;
}

export function nextTitle(chess) {
  return CHESS_TITLES.find(([cutoff]) => cutoff > chess) || null;
}

export function ratingDeviation(games, settings = RATING_SETTINGS) {
  return 1 / Math.sqrt(1 / settings.rd0 ** 2 + (games * Math.LN10 ** 2) / 400 ** 2 / 4);
}

// The sheet matches names by wrapping both sides in commas, removing spaces
// and using case-insensitive SEARCH, which is exact name equality.
export function nameKey(name) {
  return String(name ?? "").replace(/\s+/g, "").toLowerCase();
}

// One game's Elo arithmetic (one row of the Elo Calc tab).
export function scoreGame({ outcome, goodRatings, evilRatings, settings = RATING_SETTINGS }) {
  const goodCount = goodRatings.length;
  const evilCount = evilRatings.length;
  const goodAvg = goodCount ? average(goodRatings) : null;
  const evilAvg = evilCount ? average(evilRatings) : null;
  const hasProbability = goodAvg !== null && evilAvg !== null;
  const pGood = hasProbability ? winProbability(goodAvg, evilAvg, settings.evilAdvantage) : null;
  const pNumber = pGood ?? 0.5;
  const s = outcome === "Good" ? 1 : 0;
  const total = goodCount + evilCount;
  const wGood = settings.scaleByTeamSize && goodCount ? total / (2 * goodCount) : 1;
  const wEvil = settings.scaleByTeamSize && evilCount ? total / (2 * evilCount) : 1;
  const rawGood = hasProbability ? settings.k * wGood * (s - pGood) : 0;
  const rawEvil = hasProbability ? -settings.k * wEvil * (s - pGood) : 0;
  const biggest = Math.max(Math.abs(rawGood), Math.abs(rawEvil));
  const cap = biggest > settings.k ? settings.k / biggest : 1;
  return {
    goodCount,
    evilCount,
    goodAvg,
    evilAvg,
    pGood,
    pNumber,
    rawGood,
    rawEvil,
    cap,
    goodChange: rawGood * cap,
    evilChange: rawEvil * cap,
  };
}

/**
 * Run the whole rating model.
 *
 * @param {Array} games chronological games: { id, date, outcome, winNames, lossNames, ... }
 * @param {Array<string>} roster player columns in sheet order (slot order). Names
 *   found in Win/Loss lists that are not on the roster are appended as new
 *   slots, the same as adding a column after the last one.
 */
export function computeRatings(games, roster = [], settings = RATING_SETTINGS) {
  const slots = [];
  const slotByKey = new Map();
  const addSlot = name => {
    const key = nameKey(name);
    if (!key || slotByKey.has(key)) return;
    slotByKey.set(key, slots.length);
    slots.push(String(name).trim());
  };
  roster.forEach(addSlot);
  games.forEach(game => {
    if (game.outcome !== "Good" && game.outcome !== "Evil") return;
    [...(game.winNames || []), ...(game.lossNames || [])].forEach(addSlot);
  });

  const count = slots.length;
  const ratings = new Array(count).fill(settings.start);
  const history = slots.map(() => [settings.start]);
  const sideRows = [];
  const rated = [];

  games.forEach(game => {
    if (game.outcome !== "Good" && game.outcome !== "Evil") return;
    const winKeys = new Set((game.winNames || []).map(nameKey));
    const lossKeys = new Set((game.lossNames || []).map(nameKey));
    const winSide = game.outcome === "Good" ? 1 : -1;
    const sides = slots.map(name => {
      const key = nameKey(name);
      if (winKeys.has(key)) return winSide;
      if (lossKeys.has(key)) return -winSide;
      return 0;
    });
    const before = ratings.slice();
    const goodRatings = [];
    const evilRatings = [];
    sides.forEach((side, slot) => {
      if (side === 1) goodRatings.push(before[slot]);
      if (side === -1) evilRatings.push(before[slot]);
    });
    const score = scoreGame({ outcome: game.outcome, goodRatings, evilRatings, settings });
    const listedCount = (game.winNames || []).length + (game.lossNames || []).length;
    const changes = sides.map(side => (side === 1 ? score.goodChange : side === -1 ? score.evilChange : 0));
    changes.forEach((change, slot) => {
      ratings[slot] += change;
      history[slot].push(ratings[slot]);
    });

    const upsetWinner = score.pGood !== null && (winSide === 1 ? score.pGood < 0.5 : 1 - score.pGood < 0.5);
    rated.push({
      number: rated.length + 1,
      game,
      winSide,
      sides,
      before,
      after: ratings.slice(),
      changes,
      check: score.goodCount + score.evilCount === listedCount,
      upset: upsetWinner,
      ...score,
    });
    sideRows.push({ sides, winSide, pNumber: score.pNumber });
  });

  const players = slots.map((name, slot) => buildPlayer(name, slot, rated, history[slot], settings));
  const ratedPlayers = players.filter(player => player.rated);
  players.forEach(player => {
    player.percentile = player.rated
      ? ratedPlayers.filter(other => other.elo < player.elo).length / ratedPlayers.length
      : null;
    player.eloTier = player.rated ? tierFor(player.percentile, TIER_CUTOFFS.elo) : "";
  });

  const leaderboard = players
    .filter(player => player.onLeaderboard)
    .sort((a, b) => b.elo - a.elo || a.slot - b.slot)
    .map((player, index) => ({ ...player, rank: index + 1 }));
  leaderboard.forEach(entry => { players[entry.slot].rank = entry.rank; });

  const aura = players
    .filter(player => player.onLeaderboard && player.aura > 0)
    .sort((a, b) => b.aura - a.aura || a.slot - b.slot);
  const topAura = aura[0]?.aura || 0;
  const auraBoard = aura.map((player, index) => ({
    ...player,
    rank: index + 1,
    auraShare: topAura ? player.aura / topAura : 0,
  }));
  auraBoard.forEach(entry => { players[entry.slot].auraRank = entry.rank; });

  const rookies = players
    .filter(player => player.rated)
    .sort((a, b) => b.debutIndex - a.debutIndex || b.slot - a.slot)
    .slice(0, settings.rookieCount)
    .sort((a, b) => b.elo - a.elo || a.slot - b.slot)
    .map((player, index) => ({ ...player, rank: index + 1, tier: player.eloTier }));

  const upsets = players
    .filter(player => player.underdogGames >= settings.minUnderdogGames)
    .sort((a, b) => b.upsetRate - a.upsetRate || b.upsetWins - a.upsetWins || a.slot - b.slot)
    .map((player, index) => ({ ...player, rank: index + 1, tier: tierFor(player.upsetRate, TIER_CUTOFFS.upset) }));

  const duos = computeDuos(players, sideRows);
  const duoBoard = duos
    .filter(duo => duo.games >= settings.minDuoGames)
    .sort((a, b) => b.winRate - a.winRate || b.wins - a.wins || a.pair - b.pair)
    .map((duo, index) => ({ ...duo, rank: index + 1, tier: tierFor(duo.winRate, TIER_CUTOFFS.duo) }));

  const goodWins = rated.filter(row => row.winSide === 1).length;
  const goodWinRate = rated.length ? goodWins / rated.length : null;
  const topElo = leaderboard[0]?.elo ?? null;

  return {
    settings,
    slots,
    players,
    playerByName: new Map(players.map(player => [nameKey(player.name), player])),
    games: rated,
    gameById: new Map(rated.map(row => [row.game.id, row])),
    leaderboard,
    aura: auraBoard,
    rookies,
    upsets,
    duos,
    duoBoard,
    record: {
      gamesRated: rated.length,
      playersRated: ratedPlayers.length,
      playersOnLeaderboard: leaderboard.length,
      goodWinRate,
      suggestedEvilAdvantage:
        goodWinRate && goodWinRate < 1 ? 400 * Math.log10((1 - goodWinRate) / goodWinRate) : null,
      suggestedStretch:
        topElo !== null && topElo !== settings.start
          ? (settings.chessTarget - settings.chessAverage) / (topElo - settings.start)
          : null,
      gamesToCheck: rated.filter(row => !row.check).length,
      totalRating: ratings.reduce((sum, value) => sum + value, 0),
    },
  };
}

function buildPlayer(name, slot, rated, history, settings) {
  const player = {
    name,
    slot,
    elo: history[history.length - 1],
    games: 0,
    goodWins: 0,
    goodLosses: 0,
    evilWins: 0,
    evilLosses: 0,
    wins: 0,
    losses: 0,
    peak: Math.max(...history),
    low: Math.min(...history),
    lastSwing: null,
    debutIndex: -1,
    debutGame: null,
    lastIndex: -1,
    underdogGames: 0,
    upsetWins: 0,
    timeline: [],
  };

  rated.forEach((row, index) => {
    const side = row.sides[slot];
    if (!side) return;
    const won = side === row.winSide;
    player.games += 1;
    if (side === 1 && won) player.goodWins += 1;
    if (side === 1 && !won) player.goodLosses += 1;
    if (side === -1 && won) player.evilWins += 1;
    if (side === -1 && !won) player.evilLosses += 1;
    if (player.debutIndex < 0) {
      player.debutIndex = index;
      player.debutGame = row.game;
    }
    player.lastIndex = index;
    const teamChance = side === 1 ? row.pNumber : 1 - row.pNumber;
    const underdog = teamChance < 0.5;
    if (underdog) {
      player.underdogGames += 1;
      if (won) player.upsetWins += 1;
    }
    player.timeline.push({
      index,
      game: row.game,
      side: side === 1 ? "Good" : "Evil",
      won,
      teamChance,
      underdog,
      before: row.before[slot],
      after: row.after[slot],
      change: row.changes[slot],
    });
  });

  player.wins = player.goodWins + player.evilWins;
  player.losses = player.goodLosses + player.evilLosses;
  player.winRate = player.games ? player.wins / player.games : null;
  player.goodGames = player.goodWins + player.goodLosses;
  player.evilGames = player.evilWins + player.evilLosses;
  player.lastSwing = player.timeline.length ? player.timeline[player.timeline.length - 1].change : null;
  player.rated = player.games > 0;
  player.onLeaderboard = player.games >= settings.leaderboardMin;
  player.provisional = player.games < settings.provisionalGames;
  player.rd = ratingDeviation(player.games, settings);
  player.rangeLow = player.elo - 1.96 * player.rd;
  player.rangeHigh = player.elo + 1.96 * player.rd;
  player.upsetRate = player.underdogGames ? player.upsetWins / player.underdogGames : null;
  player.aboveStart = player.elo - settings.start;
  player.aura = Math.max(player.elo - settings.start, 0) * player.games;
  player.chess = chessElo(player.elo, settings);
  player.chessPeak = chessElo(player.peak, settings);
  player.title = chessTitle(player.chess);
  player.rank = null;
  player.auraRank = null;
  return player;
}

function computeDuos(players, sideRows) {
  const duos = [];
  let pair = 0;
  for (let a = 0; a < players.length; a += 1) {
    for (let b = a + 1; b < players.length; b += 1) {
      pair += 1;
      let games = 0;
      let wins = 0;
      let expected = 0;
      sideRows.forEach(row => {
        const side = row.sides[a];
        if (!side || side !== row.sides[b]) return;
        games += 1;
        if (side === row.winSide) wins += 1;
        expected += side === 1 ? row.pNumber : 1 - row.pNumber;
      });
      if (!games) continue;
      const winRate = wins / games;
      const expectedRate = expected / games;
      duos.push({
        pair,
        a: players[a].name,
        b: players[b].name,
        name: `${players[a].name} + ${players[b].name}`,
        games,
        wins,
        losses: games - wins,
        winRate,
        expectedRate,
        vsExpected: (winRate - expectedRate) * 100,
      });
    }
  }
  return duos;
}

// Head-to-head between two named players, from rated games only.
export function headToHead(model, nameA, nameB) {
  const a = model.playerByName.get(nameKey(nameA));
  const b = model.playerByName.get(nameKey(nameB));
  if (!a || !b) return null;
  const result = { together: 0, togetherWins: 0, opposed: 0, aWins: 0, bWins: 0, games: [] };
  model.games.forEach(row => {
    const sa = row.sides[a.slot];
    const sb = row.sides[b.slot];
    if (!sa || !sb) return;
    if (sa === sb) {
      result.together += 1;
      if (sa === row.winSide) result.togetherWins += 1;
      result.games.push({ row, kind: "together", won: sa === row.winSide });
    } else {
      result.opposed += 1;
      if (sa === row.winSide) result.aWins += 1;
      else result.bWins += 1;
      result.games.push({ row, kind: "opposed", winner: sa === row.winSide ? a.name : b.name });
    }
  });
  return result;
}

// Preview a hypothetical game for the matchup simulator.
export function previewMatchup(model, goodNames, evilNames) {
  const rating = name => model.playerByName.get(nameKey(name))?.elo ?? model.settings.start;
  const goodRatings = goodNames.map(rating);
  const evilRatings = evilNames.map(rating);
  const ifGood = scoreGame({ outcome: "Good", goodRatings, evilRatings, settings: model.settings });
  const ifEvil = scoreGame({ outcome: "Evil", goodRatings, evilRatings, settings: model.settings });
  return { pGood: ifGood.pGood, goodAvg: ifGood.goodAvg, evilAvg: ifGood.evilAvg, ifGood, ifEvil };
}

function average(values) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}
