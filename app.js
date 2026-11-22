import {
  CHESS_TITLES,
  RATING_SETTINGS,
  TIER_CUTOFFS,
  TITLE_NAMES,
  chessElo,
  computeRatings,
  headToHead,
  nameKey,
  nextTitle,
  previewMatchup,
} from "./ratings.js?v=20261122";

const RECORD_CSV = "Blood on the Clocktower - Games Sheet.csv";
const GAMES_SHEET_JSON = "games-sheet.json";
const DEFAULT_ENTRY_PASSCODE = "psip";

// The home page is themed around these two. Change the names here to re-theme it.
const LEGENDS = { day: "Rohan", night: "Natalie" };

const BASE_COLUMNS = ["", "Outcome", "Final Day", "Storyteller", "Player Count", "Format", "Script", "Win", "Loss"];

const TRAVELER_ROLES = new Set([
  "Apprentice", "Barista", "Beggar", "Bishop", "Bone Collector", "Bureaucrat", "Butcher", "Cacklejack",
  "Deviant", "Gangster", "Gnome", "Gunslinger", "Harlot", "Judge", "Matron", "Scapegoat", "Thief", "Voudon",
]);

const GOOD_ROLES = new Set([
  // Townsfolk
  "Acrobat", "Alchemist", "Alsaahir", "Amnesiac", "Artist", "Atheist", "Balloonist", "Banshee", "Bounty Hunter",
  "Cannibal", "Chambermaid", "Chef", "Choirboy", "Clockmaker", "Courtier", "Cult Leader", "Dreamer", "Empath",
  "Engineer", "Exorcist", "Farmer", "Fisherman", "Flowergirl", "Fool", "Fortune Teller", "Gambler", "General",
  "Gossip", "Grandmother", "High Priestess", "Huntsman", "Innkeeper", "Investigator", "Juggler", "King", "Knight",
  "Librarian", "Lycanthrope", "Magician", "Mathematician", "Mayor", "Minstrel", "Monk", "Nightwatchman", "Noble",
  "Oracle", "Pacifist", "Philosopher", "Pixie", "Poppy Grower", "Preacher", "Princess", "Professor", "Ravenkeeper",
  "Sage", "Sailor", "Savant", "Seamstress", "Shugenja", "Slayer", "Snake Charmer", "Soldier", "Steward", "Tea Lady",
  "Town Crier", "Undertaker", "Village Idiot", "Virgin", "Washerwoman",
  // Outsiders
  "Barber", "Butler", "Damsel", "Drunk", "Golem", "Goon", "Hatter", "Heretic", "Hermit", "Klutz", "Lunatic",
  "Moonchild", "Mutant", "Ogre", "Plague Doctor", "Politician", "Puzzlemaster", "Recluse", "Saint", "Snitch",
  "Sweetheart", "Tinker", "Zealot",
]);

const DEMON_ROLES = new Set([
  "Al-Hadikhia", "Fang Gu", "Imp", "Kazali", "Legion", "Leviathan", "Lil' Monsta", "Lleech", "Lord of Typhon",
  "No Dashii", "Ojo", "Po", "Pukka", "Riot", "Shabaloth", "Vigormortis", "Vortox", "Yaggababble", "Zombuul",
]);

const EVIL_ROLES = new Set([
  ...DEMON_ROLES,
  "Assassin", "Baron", "Boffin", "Boomdandy", "Cerenovus", "Devil's Advocate", "Evil Twin", "Fearmonger", "Goblin",
  "Godfather", "Harpy", "Marionette", "Mastermind", "Mezepheles", "Organ Grinder", "Pit Hag", "Poisoner",
  "Psychopath", "Scarlet Woman", "Spy", "Summoner", "Vizier", "Widow", "Witch", "Wizard", "Wraith", "Xaan",
]);

// Alignment for traveller rows that are not in the Win/Loss lists.
const SEEDED_TRAVELER_ALIGNMENT = {
  "1/25/26|Kate|Barista": "Good",
  "1/25/26|Will|Bone Collector": "Evil",
  "4/4/26|Filippos|Deviant": "Good",
  "4/4/26|Morgan|Barista": "Evil",
  "10/31/26|Andreas|Judge": "Good",
};

const VIEWS = ["home", "rankings", "tiers", "players", "games", "stats", "about"];
const MINUS = "−";
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = {
  headers: [],
  roster: [],
  players: [],
  games: [],
  draftPlayers: new Set(),
  draftRoles: new Set(),
  databaseAvailable: false,
  activePasscode: "",
  pendingDeleteGameId: "",
  pendingEditGameId: "",
  editingGameId: "",
  stats: [],
  issues: [],
  model: null,
  view: "home",
  scale: "chess",
  tableSort: { key: "rank", dir: 1 },
  compare: [LEGENDS.day, LEGENDS.night],
  oracle: new Map(),
};

const els = {};
const charts = new Map();

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();
  drawSky();
  startClock();

  try {
    const databaseState = await loadDatabaseState();
    const source = databaseState || await loadStaticGamesSheet();
    state.databaseAvailable = Boolean(databaseState);
    state.headers = source.headers;
    state.roster = state.headers.slice(BASE_COLUMNS.length).filter(Boolean);
    state.games = source.games;
    seedOracle();
    rebuild();
    applyRuntimeMode();
    route();
  } catch (error) {
    console.error(error);
    els.main.innerHTML = `<section class="view is-active"><div class="panel empty-state">Unable to load game data. Confirm that <code>${GAMES_SHEET_JSON}</code> or <code>${escapeHtml(RECORD_CSV)}</code> was deployed with the site, then reload the page.</div></section>`;
  }
}

/* ---------------------------------------------------------------- loading */

async function loadDatabaseState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return null;
    const payload = await response.json();
    return Array.isArray(payload.games) ? payload : null;
  } catch {
    return null;
  }
}

async function loadStaticGamesSheet() {
  try {
    const response = await fetch(GAMES_SHEET_JSON, { cache: "no-store" });
    if (!response.ok) throw new Error(`Could not load ${GAMES_SHEET_JSON}`);
    const snapshot = await response.json();
    if (!Array.isArray(snapshot.headers) || !Array.isArray(snapshot.games)) throw new Error("Bad snapshot");
    return snapshot;
  } catch (snapshotError) {
    const response = await fetch(encodeURI(RECORD_CSV), { cache: "no-store" });
    if (!response.ok) throw snapshotError;
    return csvGamesSheetState(await response.text());
  }
}

function csvGamesSheetState(text) {
  const rows = parseCsv(text);
  const sourceHeaders = (rows[1] || []).map(clean);
  const hasFormat = clean(sourceHeaders[5]).toLowerCase() === "format";
  const base = hasFormat ? 9 : 8;
  const at = (row, column) => clean(row[hasFormat || column < 5 ? column : column - 1]);
  const playerHeaders = sourceHeaders.slice(base).filter(Boolean);
  const games = rows.slice(2)
    .filter(row => clean(row[0]) && clean(row[1]))
    .map((row, index) => ({
      id: `games-sheet-${index}`,
      source: "games-sheet",
      date: csvDateToDisplay(row[0]),
      outcome: clean(row[1]),
      finalDay: finalDayValue(row[2]),
      storyteller: at(row, 3),
      playerCount: numberOrZero(row[4]),
      format: hasFormat ? at(row, 5) : "",
      script: at(row, 6),
      winNames: splitNames(at(row, 7)),
      lossNames: splitNames(at(row, 8)),
      roles: Object.fromEntries(
        playerHeaders
          .map((player, offset) => [player, clean(row[offset + base])])
          .filter(([, role]) => role && role.toLowerCase() !== "n/a"),
      ),
      alignmentOverrides: {},
    }));
  return { headers: BASE_COLUMNS.concat(playerHeaders), games };
}

function applyRuntimeMode() {
  document.body.classList.toggle("is-readonly", !state.databaseAvailable);
  els.eggButton.hidden = !state.databaseAvailable;
}

/* ---------------------------------------------------------------- elements & events */

function cacheElements() {
  const ids = [
    "main", "skyLayer", "navToggle", "siteNav", "legendRohan", "legendNatalie", "rivalry", "rivalryTitle", "compareA",
    "compareB", "duelChart", "statStrip", "latestGame", "recordStrip", "eloBoard", "auraBoard", "titleLadder",
    "leaderTable", "rookieTiers", "upsetTiers", "duoTiers", "playerSearch", "playerSort", "rosterGrid",
    "scriptFilter", "formatFilter", "outcomeFilter", "downloadRecord", "gamesTimeline", "gameTableBody", "issuesPanel",
    "oraclePool", "oracleResult", "oracleRandom", "oracleClear", "statsPlayer", "statsRole", "statisticsResults",
    "scriptBreakdown", "roleBreakdown", "aboutCopy", "aboutFacts", "titleTable", "cutoffTable",
    "footerUpdated", "tooltip", "eggButton", "infoDialog", "infoDialogEyebrow", "infoDialogTitle", "infoDialogContent",
    "infoDialogClose", "playerDialog", "playerDialogHeading", "playerDialogContent", "playerDialogClose", "gameDialog",
    "gameDialogEyebrow", "gameDialogName", "gameDialogContent", "gameDialogClose", "deleteDialog", "deleteForm",
    "deleteGameName", "deleteGameSummary", "deletePasscodeInput", "deleteConfirm", "deleteMessage", "passcodeDialog",
    "passcodeForm", "passcodeInput", "passcodeSubmit", "passcodeMessage", "entryDialog", "entryForm", "entryEyebrow",
    "entryTitle", "entryDate", "entryOutcome", "entryFinalDay", "entryStoryteller", "entryFormat", "entryScript",
    "participantRows", "participantTemplate", "newPlayerName", "addNewPlayer", "newRoleName", "addNewRole",
    "addParticipant", "saveEntry", "resetLocalGames", "entryMessage", "entryPreview", "playerOptions", "roleOptions",
    "scriptOptions", "clockTicks", "clockHour", "clockMinute", "clockSecond",
  ];
  ids.forEach(id => { els[id] = document.getElementById(id); });
}

function bindEvents() {
  window.addEventListener("hashchange", route);
  els.navToggle.addEventListener("click", () => {
    const open = els.siteNav.classList.toggle("is-open");
    els.navToggle.setAttribute("aria-expanded", String(open));
  });
  els.siteNav.addEventListener("click", event => {
    if (event.target.closest("a")) {
      els.siteNav.classList.remove("is-open");
      els.navToggle.setAttribute("aria-expanded", "false");
    }
  });

  // Delegated actions: anything with data-player / data-game opens a dialog.
  document.addEventListener("click", event => {
    const playerTarget = event.target.closest("[data-player]");
    if (playerTarget && !event.target.closest(".oracle-pool")) {
      event.preventDefault();
      openPlayerDialog(playerTarget.dataset.player);
      return;
    }
    const gameTarget = event.target.closest("[data-game]");
    if (gameTarget) {
      event.preventDefault();
      openGameDialog(gameTarget.dataset.game);
      return;
    }
    const duoTarget = event.target.closest("[data-duo]");
    if (duoTarget) {
      event.preventDefault();
      openDuoDialog(duoTarget.dataset.duo);
    }
  });
  document.addEventListener("keydown", event => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const target = event.target.closest("tr[data-player], tr[data-game], [role='button'][data-player], [role='button'][data-game], [role='button'][data-duo]");
    if (!target) return;
    event.preventDefault();
    target.click();
  });

  document.querySelectorAll("[data-scale]").forEach(button => button.addEventListener("click", () => {
    state.scale = button.dataset.scale;
    document.querySelectorAll("[data-scale]").forEach(item => item.classList.toggle("is-active", item === button));
    renderEloBoard();
  }));
  els.leaderTable.querySelectorAll("th[data-sort]").forEach(th => th.addEventListener("click", () => {
    const key = th.dataset.sort;
    state.tableSort = { key, dir: state.tableSort.key === key ? -state.tableSort.dir : (key === "name" || key === "rank" ? 1 : -1) };
    renderLeaderTable();
  }));

  els.compareA.addEventListener("change", () => { state.compare[0] = els.compareA.value; renderCompare(); });
  els.compareB.addEventListener("change", () => { state.compare[1] = els.compareB.value; renderCompare(); });
  els.playerSearch.addEventListener("input", renderRoster);
  els.playerSort.addEventListener("change", renderRoster);
  els.scriptFilter.addEventListener("change", renderGames);
  els.formatFilter.addEventListener("change", renderGames);
  els.outcomeFilter.addEventListener("change", renderGames);
  els.statsPlayer.addEventListener("change", () => { els.statsRole.value = ""; renderLookup(); });
  els.statsRole.addEventListener("change", () => { els.statsPlayer.value = ""; renderLookup(); });
  els.oraclePool.addEventListener("click", event => {
    const chip = event.target.closest("[data-oracle]");
    if (!chip) return;
    const name = chip.dataset.oracle;
    const current = state.oracle.get(name);
    if (!current) state.oracle.set(name, "Good");
    else if (current === "Good") state.oracle.set(name, "Evil");
    else state.oracle.delete(name);
    renderOracle();
  });
  els.oracleRandom.addEventListener("click", () => { randomOracle(); renderOracle(); });
  els.oracleClear.addEventListener("click", () => { state.oracle.clear(); renderOracle(); });

  els.infoDialogClose.addEventListener("click", () => els.infoDialog.close());
  els.playerDialogClose.addEventListener("click", () => els.playerDialog.close());
  els.gameDialogClose.addEventListener("click", () => els.gameDialog.close());
  [els.playerDialog, els.gameDialog, els.infoDialog].forEach(dialog => {
    dialog.addEventListener("close", restoreHash);
    dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  });

  els.downloadRecord.addEventListener("click", downloadRecordCsv);
  els.deleteConfirm.addEventListener("click", deleteSelectedGame);
  els.deletePasscodeInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); deleteSelectedGame(); }
  });
  els.eggButton.addEventListener("click", () => requestEntryUnlock());
  els.passcodeSubmit.addEventListener("click", submitPasscode);
  els.passcodeInput.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); submitPasscode(); }
  });
  els.entryForm.addEventListener("keydown", preventEntryFormEnterSubmit);
  els.entryForm.addEventListener("input", renderEntryPreview);
  els.entryForm.addEventListener("change", renderEntryPreview);
  els.addNewPlayer.addEventListener("click", addNewPlayerToEntry);
  els.newPlayerName.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); addNewPlayerToEntry(); }
  });
  els.addNewRole.addEventListener("click", addNewRoleToEntry);
  els.newRoleName.addEventListener("keydown", event => {
    if (event.key === "Enter") { event.preventDefault(); addNewRoleToEntry(); }
  });
  els.entryOutcome.addEventListener("change", updateAllParticipantResults);
  els.addParticipant.addEventListener("click", () => addParticipantRow());
  els.saveEntry.addEventListener("click", saveEntry);
  els.resetLocalGames.addEventListener("click", clearLocalEntries);

}

function preventEntryFormEnterSubmit(event) {
  if (event.key !== "Enter") return;
  if (event.target.closest("button")) return;
  event.preventDefault();
}

/* ---------------------------------------------------------------- routing */

function route() {
  const hash = decodeURIComponent(location.hash.replace(/^#/, ""));
  const [head, ...rest] = hash.split("/");
  const arg = rest.join("/");
  if (head === "player" && arg) {
    if (!state.model) return;
    if (!document.querySelector(".view.is-active")) setView("players");
    openPlayerDialog(arg, { fromRoute: true });
    return;
  }
  if (head === "game" && arg) {
    if (!state.model) return;
    if (!document.querySelector(".view.is-active")) setView("games");
    openGameDialog(arg, { fromRoute: true });
    return;
  }
  setView(VIEWS.includes(head) ? head : "home");
}

function setView(view) {
  const changed = state.view !== view;
  state.view = view;
  document.querySelectorAll("[data-view]").forEach(panel => panel.classList.toggle("is-active", panel.dataset.view === view));
  document.querySelectorAll("[data-nav]").forEach(link => {
    const active = link.dataset.nav === view;
    link.classList.toggle("is-active", active);
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });
  document.body.dataset.view = view;
  if (changed) window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  requestAnimationFrame(() => {
    charts.forEach(chart => { if (chart.host.offsetParent && Math.abs(chart.host.clientWidth - chart.width) > 4) chart.draw(); });
    runCountUps(document.querySelector(`[data-view="${view}"]`));
  });
}

function setHash(hash) {
  history.replaceState(null, "", hash);
}

function restoreHash() {
  if (els.playerDialog.open || els.gameDialog.open || els.infoDialog.open) return;
  if (/^#(player|game)\//.test(location.hash)) setHash(`#${state.view}`);
}

/* ---------------------------------------------------------------- derivation */

function rebuild() {
  const allGames = getAllGames();
  state.model = computeRatings(allGames, state.roster);
  state.players = collectPlayers(allGames);
  state.stats = computeStats(allGames, state.players);
  state.issues = findIssues(allGames);
  if (!state.model.playerByName.has(nameKey(state.compare[0]))) state.compare[0] = state.model.leaderboard[0]?.name || "";
  if (!state.model.playerByName.has(nameKey(state.compare[1]))) state.compare[1] = state.model.leaderboard.at(-1)?.name || "";
  renderAll();
}

function renderAll() {
  renderDatalists();
  renderHome();
  renderRankings();
  renderTiers();
  renderRoster();
  renderGameFilters();
  renderGames();
  renderStatistics();
  renderAbout();
  document.querySelectorAll("[data-setting]").forEach(node => {
    const value = RATING_SETTINGS[node.dataset.setting];
    if (value !== undefined) node.textContent = String(value);
  });
  const latest = state.model.games.at(-1)?.game;
  els.footerUpdated.textContent = latest ? `Updated through ${longDate(latest.date)}` : "";
  runCountUps(document.querySelector(".view.is-active"));
}

function getAllGames() {
  return [...state.games].sort((a, b) => compareDates(a.date, b.date));
}

function player(name) {
  return state.model.playerByName.get(nameKey(name)) || null;
}

function stat(name) {
  return state.stats.find(item => nameKey(item.player) === nameKey(name)) || null;
}

function collectPlayers(games) {
  const names = [];
  const seen = new Set();
  const add = name => {
    const key = nameKey(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    names.push(clean(name));
  };
  state.model.slots.forEach(add);
  state.draftPlayers.forEach(add);
  games.forEach(game => {
    game.winNames.forEach(add);
    game.lossNames.forEach(add);
    Object.keys(game.roles).forEach(add);
  });
  return names;
}

function computeStats(games, players) {
  return players.map(name => {
    const entry = {
      player: name,
      games: 0,
      travelsGood: 0,
      travelsEvil: 0,
      wins: 0,
      losses: 0,
      goodGames: 0,
      goodWins: 0,
      goodLosses: 0,
      evilGames: 0,
      evilWins: 0,
      evilLosses: 0,
      demonGames: 0,
      storyteller: 0,
      roles: new Map(),
      history: [],
    };
    games.forEach(game => {
      if (splitNames(game.storyteller).some(st => nameKey(st) === nameKey(name))) entry.storyteller += 1;
      const seat = getPlayerEntry(game, name);
      if (!seat.active) return;
      if (seat.isTraveler) {
        if (seat.alignment === "Good") entry.travelsGood += 1;
        if (seat.alignment === "Evil") entry.travelsEvil += 1;
        entry.history.push({ ...seat, game });
        return;
      }
      entry.games += 1;
      if (seat.result === "Win") entry.wins += 1;
      if (seat.result === "Loss") entry.losses += 1;
      if (seat.alignment === "Good") {
        entry.goodGames += 1;
        if (seat.teamResult === "Win") entry.goodWins += 1;
        if (seat.teamResult === "Loss") entry.goodLosses += 1;
      }
      if (seat.alignment === "Evil") {
        entry.evilGames += 1;
        if (seat.teamResult === "Win") entry.evilWins += 1;
        if (seat.teamResult === "Loss") entry.evilLosses += 1;
      }
      if (DEMON_ROLES.has(seat.role)) entry.demonGames += 1;
      if (seat.role) entry.roles.set(seat.role, (entry.roles.get(seat.role) || 0) + 1);
      entry.history.push({ ...seat, game });
    });
    entry.success = ratio(entry.wins, entry.games);
    entry.goodWinrate = ratio(entry.goodWins, entry.goodGames);
    entry.evilWinrate = ratio(entry.evilWins, entry.evilGames);
    entry.goodFrequency = ratio(entry.goodGames, entry.games);
    entry.evilFrequency = ratio(entry.evilGames, entry.games);
    return entry;
  });
}

function getPlayerEntry(game, name) {
  const roleKey = Object.keys(game.roles).find(key => nameKey(key) === nameKey(name));
  const role = clean(roleKey ? game.roles[roleKey] : "");
  const listedWin = game.winNames.some(item => nameKey(item) === nameKey(name));
  const listedLoss = game.lossNames.some(item => nameKey(item) === nameKey(name));
  const isTraveler = TRAVELER_ROLES.has(role);
  const active = Boolean(role) || listedWin || listedLoss;
  const listedResult = listedWin ? "Win" : listedLoss ? "Loss" : "";
  const alignment = resolveAlignment(game, roleKey || name, role, listedResult);
  const teamResult = alignment ? (alignment === game.outcome ? "Win" : "Loss") : listedResult;
  return { active, role, isTraveler, listedResult, result: listedResult || teamResult, teamResult, alignment };
}

function resolveAlignment(game, name, role, result) {
  const override = game.alignmentOverrides?.[name];
  if (override === "Good" || override === "Evil") return override;
  const seeded = SEEDED_TRAVELER_ALIGNMENT[`${game.date}|${name}|${role}`];
  if (seeded) return seeded;
  if (result === "Win") return game.outcome;
  if (result === "Loss") return oppositeOutcome(game.outcome);
  if (GOOD_ROLES.has(role)) return "Good";
  if (EVIL_ROLES.has(role)) return "Evil";
  return "";
}

function roleAlignment(role) {
  if (GOOD_ROLES.has(role)) return "Good";
  if (EVIL_ROLES.has(role)) return "Evil";
  return "";
}

function oppositeOutcome(outcome) {
  return outcome === "Good" ? "Evil" : "Good";
}

function findIssues(games) {
  const issues = [];
  games.forEach(game => {
    const listed = new Set([...game.winNames, ...game.lossNames].map(nameKey));
    Object.entries(game.roles).forEach(([name, role]) => {
      if (TRAVELER_ROLES.has(role)) return;
      if (!listed.has(nameKey(name))) issues.push(`${game.date}: ${name} has ${role} but is not in Win or Loss.`);
    });
    [...game.winNames, ...game.lossNames].forEach(name => {
      if (!Object.keys(game.roles).some(key => nameKey(key) === nameKey(name))) issues.push(`${game.date}: ${name} is listed in results but has no role recorded.`);
    });
  });
  const unmatched = state.model.games.filter(row => !row.check);
  unmatched.forEach(row => issues.push(`${row.game.date}: Win/Loss names do not all match a player column.`));
  return issues;
}

/* ---------------------------------------------------------------- home */

function renderHome() {
  const model = state.model;
  const day = player(LEGENDS.day);
  const night = player(LEGENDS.night);
  const dayLine = document.querySelector(".hero-line-day");
  if (day && dayLine) {
    const full = (TITLE_NAMES[day.title] || day.title).toLowerCase();
    dayLine.textContent = `${day.name} is merely ${/^[aeiou]/.test(full) ? "an" : "a"} ${full}.`;
  }
  const nightLine = document.querySelector(".hero-line-night");
  if (nightLine) nightLine.textContent = `${LEGENDS.night} is god.`;

  els.legendRohan.innerHTML = day ? legendCard(day, false) : "";
  els.legendNatalie.innerHTML = night ? legendCard(night, true) : "";

  const options = model.players.filter(item => item.rated).sort((a, b) => a.name.localeCompare(b.name))
    .map(item => `<option value="${escapeHtml(item.name)}">${escapeHtml(item.name)}</option>`).join("");
  els.compareA.innerHTML = options;
  els.compareB.innerHTML = options;
  els.compareA.value = state.compare[0];
  els.compareB.value = state.compare[1];
  renderCompare();

  const scripts = new Set(model.games.map(row => row.game.script).filter(Boolean));
  const upsets = model.games.filter(row => row.upset).length;
  els.statStrip.innerHTML = [
    statTile(model.record.gamesRated, "Games"),
    statTile(model.record.playersRated, "Players"),
    statTile(Math.round((model.record.goodWinRate || 0) * 100), "Good win rate", "%"),
    statTile(upsets, "Underdog wins"),
    statTile(scripts.size, "Scripts"),
  ].join("");

  const last = model.games.at(-1);
  els.latestGame.innerHTML = last ? latestGameCard(last) : `<p class="empty-state">No games yet.</p>`;
}

function legendCard(p, isNight) {
  const title = isNight ? "god" : TITLE_NAMES[p.title] || p.title;
  const figure = isNight
    ? `<span class="legend-number legend-infinity">∞</span><small>Divine rating</small>`
    : `<span class="legend-number" data-count="${Math.round(p.chess)}">${fmtInt(p.chess)}</span><small>Chess Elo</small>`;
  return `
    <div class="legend-emblem">${sigilSvg(p.name, 92)}</div>
    <h2 class="legend-name">${escapeHtml(p.name)}</h2>
    <p class="legend-title">${escapeHtml(title)}</p>
    <div class="legend-figure">${figure}</div>
    <a class="button ${isNight ? "button-moon" : "button-gold"}" href="#player/${encodeURIComponent(p.name)}" data-player="${escapeHtml(p.name)}">Profile</a>`;
}

function renderCompare() {
  renderRivalry(player(state.compare[0]), player(state.compare[1]));
  renderDuel();
}

// Side-by-side comparison of the two players in the compare pickers (default: the two legends).
// Identical rows for both, better value highlighted. Left uses the gold styling, right the lavender.
function renderRivalry(day, night) {
  els.rivalryTitle.textContent = day && night && day.slot !== night.slot ? `${day.name} vs. ${night.name}` : "Compare";
  if (!day || !night || day.slot === night.slot) {
    els.rivalry.innerHTML = `<p class="section-copy">Pick two different players.</p>`;
    return;
  }
  const sd = stat(day.name);
  const sn = stat(night.name);
  const h2h = headToHead(state.model, day.name, night.name);
  const together = h2h.together;
  const expectedTogether = h2h.games.filter(g => g.kind === "together")
    .reduce((sum, g) => sum + (g.row.sides[day.slot] === 1 ? g.row.pNumber : 1 - g.row.pNumber), 0);
  const rank = n => (n ? ` <small>#${n}</small>` : "");
  const wl = (w, l) => `${w}–${l}`;
  // [label, day value, night value, day score, night score]; scores mark the better value, null = not compared.
  const rows = [
    ["Chess Elo", fmtInt(day.chess) + rank(day.rank), fmtInt(night.chess) + rank(night.rank), day.chess, night.chess],
    ["Base Elo", fmtInt(day.elo), fmtInt(night.elo), day.elo, night.elo],
    ["Peak chess Elo", fmtInt(day.chessPeak), fmtInt(night.chessPeak), day.chessPeak, night.chessPeak],
    ["Aura", fmtInt(day.aura) + rank(day.auraRank), fmtInt(night.aura) + rank(night.auraRank), day.aura, night.aura],
    ["Games", day.games, night.games, null, null],
    ["Record", `${wl(day.wins, day.losses)} <small>${fmtPct(day.winRate)}</small>`, `${wl(night.wins, night.losses)} <small>${fmtPct(night.winRate)}</small>`, day.winRate, night.winRate],
    ["As Good", wl(day.goodWins, day.goodLosses), wl(night.goodWins, night.goodLosses), ratio(day.goodWins, day.goodGames), ratio(night.goodWins, night.goodGames)],
    ["As Evil", wl(day.evilWins, day.evilLosses), wl(night.evilWins, night.evilLosses), ratio(day.evilWins, day.evilGames), ratio(night.evilWins, night.evilGames)],
    ["Wins as underdog", `${day.upsetWins} of ${day.underdogGames}`, `${night.upsetWins} of ${night.underdogGames}`, day.upsetRate, night.upsetRate],
    ["Demon games", sd?.demonGames ?? 0, sn?.demonGames ?? 0, null, null],
    ["Times storyteller", sd?.storyteller ?? 0, sn?.storyteller ?? 0, null, null],
  ];
  const cell = (value, mine, theirs, side) => {
    const compared = mine !== null && mine !== undefined && theirs !== null && theirs !== undefined && mine !== theirs;
    const cls = compared ? (mine > theirs ? "is-lead" : "is-trail") : "";
    return `<td class="tape-${side} ${cls}">${value}</td>`;
  };
  const body = rows.map(([label, dv, nv, ds, ns]) => `<tr>${cell(dv, ds, ns, "day")}<th scope="row">${label}</th>${cell(nv, ns, ds, "night")}</tr>`).join("");
  const medallions = h2h.games.map(g => {
    const game = g.row.game;
    let cls;
    let label;
    if (g.kind === "opposed") {
      cls = g.winner === day.name ? "medal-day" : "medal-night";
      label = `${g.winner} won (opposite teams)`;
    } else {
      cls = g.won ? "medal-both" : "medal-none";
      label = g.won ? "Won together" : "Lost together";
    }
    const daySide = g.row.sides[day.slot] === 1 ? "Good" : "Evil";
    const nightSide = g.row.sides[night.slot] === 1 ? "Good" : "Evil";
    return `<button class="medal ${cls}" type="button" data-game="${escapeHtml(game.id)}" data-tip="${escapeHtml(`${shortDate(game.date)} · ${game.script}\n${day.name}: ${daySide} · ${night.name}: ${nightSide}\n${label}`)}">
      <span class="medal-icon" aria-hidden="true">${medalIcon(cls)}</span>
      <span class="medal-date">${monthYear(game.date)}</span>
      <span class="visually-hidden">${escapeHtml(label)}, ${escapeHtml(longDate(game.date))}</span>
    </button>`;
  }).join("");
  els.rivalry.innerHTML = `
    <table class="tape">
      <thead>
        <tr>
          <th scope="col" class="tape-day"><span class="tape-name">${escapeHtml(day.name)}${sigilSvg(day.name, 32)}</span></th>
          <th scope="col"><span class="visually-hidden">Stat</span></th>
          <th scope="col" class="tape-night"><span class="tape-name">${sigilSvg(night.name, 32)}${escapeHtml(night.name)}</span></th>
        </tr>
      </thead>
      <tbody>
        ${body}
        <tr class="tape-section"><th colspan="3" scope="colgroup">Against each other</th></tr>
        <tr>${cell(h2h.aWins, h2h.aWins, h2h.bWins, "day")}<th scope="row">Wins, opposite teams</th>${cell(h2h.bWins, h2h.bWins, h2h.aWins, "night")}</tr>
        <tr class="tape-shared"><td colspan="3">Same team: ${wl(h2h.togetherWins, together - h2h.togetherWins)}${together ? ` <small>Elo expected ${fmtPct(expectedTogether / together)}</small>` : ""}</td></tr>
      </tbody>
    </table>
    <div class="medal-track" aria-label="Shared games, oldest first">${medallions || `<p class="section-copy">No games together yet.</p>`}</div>
    <div class="medal-legend">
      <span><i class="medal-key medal-day"></i>${escapeHtml(day.name)} beat ${escapeHtml(night.name)}</span>
      <span><i class="medal-key medal-night"></i>${escapeHtml(night.name)} beat ${escapeHtml(day.name)}</span>
      <span><i class="medal-key medal-both"></i>Won together</span>
      <span><i class="medal-key medal-none"></i>Lost together</span>
    </div>`;
  bindTips(els.rivalry);
}

function medalIcon(cls) {
  if (cls === "medal-day") return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
  if (cls === "medal-night") return `<svg viewBox="0 0 24 24"><path d="M15.5 3.5A8.5 8.5 0 1 0 20.5 15 7 7 0 0 1 15.5 3.5Z" fill="currentColor"/></svg>`;
  if (cls === "medal-both") return `<svg viewBox="0 0 24 24"><circle cx="9" cy="12" r="4.5" fill="var(--gold)"/><path d="M15 6.5A6 6 0 1 0 18.5 16 4.8 4.8 0 0 1 15 6.5Z" fill="var(--moon)"/></svg>`;
  return `<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-dasharray="2 2.4"/></svg>`;
}

function renderDuel() {
  const names = state.compare.filter(Boolean);
  const colors = ["var(--gold)", "var(--moon)"];
  const series = names.map((name, index) => eloSeries(name, colors[index])).filter(Boolean);
  drawEloChart(els.duelChart, series, { height: 320 });
}

function eloSeries(name, color) {
  const p = player(name);
  if (!p) return null;
  const values = [RATING_SETTINGS.start, ...state.model.games.map(row => row.after[p.slot])];
  const played = [false, ...state.model.games.map(row => row.sides[p.slot] !== 0)];
  return { name: p.name, color, values, played, slot: p.slot };
}

function statTile(value, label, suffix = "", note = "") {
  return `<article class="stat-tile"><strong><span data-count="${value}">${fmtInt(value)}</span>${suffix}</strong><span>${escapeHtml(label)}</span>${note ? `<small>${escapeHtml(note)}</small>` : ""}</article>`;
}

function latestGameCard(row) {
  const game = row.game;
  const movers = row.sides.map((side, slot) => ({ side, slot, change: row.changes[slot] })).filter(item => item.side);
  const top = movers.sort((a, b) => b.change - a.change)[0];
  const topName = top ? state.model.slots[top.slot] : "";
  const details = [
    game.storyteller ? `Storyteller: ${escapeHtml(game.storyteller)}` : "",
    topName ? `Biggest gain: ${escapeHtml(topName)} ${fmtSigned(top.change)}` : "",
  ].filter(Boolean).join(" · ");
  return `
    <p class="eyebrow">Latest game · ${escapeHtml(longDate(game.date))}</p>
    <h3>${escapeHtml(game.script || "Game")} <span class="tag ${game.outcome === "Good" ? "tag-good" : "tag-evil"}">${escapeHtml(game.outcome)} won</span>${row.upset ? ` <span class="tag tag-upset">Upset</span>` : ""}</h3>
    ${details ? `<p class="section-copy">${details}</p>` : ""}
    ${forecastBar(row)}
    <button class="button button-ghost" type="button" data-game="${escapeHtml(game.id)}">Open game</button>`;
}

/* ---------------------------------------------------------------- rankings */

function renderRankings() {
  const r = state.model.record;
  els.recordStrip.innerHTML = [
    statTile(r.gamesRated, "Games"),
    statTile(r.playersRated, "Players"),
    statTile(r.playersOnLeaderboard, "Listed"),
    statTile(Math.round((r.goodWinRate || 0) * 100), "Good win rate", "%"),
  ].join("");
  renderEloBoard();
  renderAuraBoard();
  renderTitleLadder();
  renderLeaderTable();
}

function renderEloBoard() {
  const board = state.model.leaderboard;
  const chess = state.scale === "chess";
  const top = board[0];
  const value = p => (chess ? p.chess : p.elo);
  const max = Math.max(...board.map(value), 1);
  const min = chess ? 0 : Math.min(...board.map(value)) - 40;
  els.eloBoard.innerHTML = board.map(p => {
    const width = Math.max(2, ((value(p) - min) / (max - min)) * 100);
    const range = p.provisional ? `<small class="range">${fmtInt(chess ? chessElo(p.rangeLow) : p.rangeLow)}–${fmtInt(chess ? chessElo(p.rangeHigh) : p.rangeHigh)}</small>` : "";
    return `
      <div class="board-row ${legendClass(p.name)} ${p.provisional ? "is-provisional" : ""}" role="button" tabindex="0" data-player="${escapeHtml(p.name)}">
        <span class="board-rank">${p.rank}</span>
        <span class="board-sigil">${sigilSvg(p.name, 34)}</span>
        <span class="board-name"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(p.title)} · ${p.wins}–${p.losses}${p.provisional ? " · provisional" : ""}</small></span>
        <span class="board-bar"><i style="--w:${width.toFixed(1)}%"></i></span>
        <span class="board-value">${fmtInt(value(p))}${range}</span>
        <span class="board-swing ${p.lastSwing >= 0 ? "up" : "down"}">${fmtSigned(p.lastSwing)}</span>
      </div>`;
  }).join("") || `<p class="empty-state">No players have ${RATING_SETTINGS.leaderboardMin} games yet.</p>`;
  if (top) els.eloBoard.dataset.top = top.name;
}

function renderAuraBoard() {
  const board = state.model.aura;
  els.auraBoard.innerHTML = board.map(p => `
    <div class="board-row aura-row ${legendClass(p.name)}" role="button" tabindex="0" data-player="${escapeHtml(p.name)}">
      <span class="board-rank">${p.rank}</span>
      <span class="board-sigil">${sigilSvg(p.name, 34)}</span>
      <span class="board-name"><strong>${escapeHtml(p.name)}</strong><small>+${fmtInt(p.aboveStart)} × ${plural(p.games, "game")}</small></span>
      <span class="board-bar aura-bar"><i style="--w:${Math.max(2, p.auraShare * 100).toFixed(1)}%"></i></span>
      <span class="board-value">${fmtInt(p.aura)}<small class="range">${fmtPct(p.auraShare)} of #1</small></span>
    </div>`).join("") || `<p class="empty-state">Nobody has Aura yet.</p>`;
}

function renderLeaderTable() {
  const { key, dir } = state.tableSort;
  const rows = [...state.model.leaderboard].sort((a, b) => {
    const av = key === "aura" ? a.aura : a[key];
    const bv = key === "aura" ? b.aura : b[key];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return ((av ?? -Infinity) - (bv ?? -Infinity)) * dir || a.rank - b.rank;
  });
  els.leaderTable.querySelectorAll("th[data-sort]").forEach(th => {
    th.dataset.dir = th.dataset.sort === key ? (dir > 0 ? "asc" : "desc") : "";
    th.setAttribute("aria-sort", th.dataset.sort === key ? (dir > 0 ? "ascending" : "descending") : "none");
  });
  els.leaderTable.querySelector("tbody").innerHTML = rows.map(p => `
    <tr data-player="${escapeHtml(p.name)}" tabindex="0" class="${legendClass(p.name)}">
      <td>${p.rank}</td>
      <td><span class="cell-player">${sigilSvg(p.name, 24)}${escapeHtml(p.name)}</span></td>
      <td class="num">${fmtInt(p.chess)}</td>
      <td>${escapeHtml(p.title)}</td>
      <td class="num">${p.games}</td>
      <td class="num">${p.wins}–${p.losses} <small>${fmtPct(p.winRate)}</small></td>
      <td class="num">${fmtInt(p.elo)}</td>
      <td class="num">${p.provisional ? `${fmtInt(p.rangeLow)}–${fmtInt(p.rangeHigh)}` : "—"}</td>
      <td class="num ${p.lastSwing >= 0 ? "up" : "down"}">${fmtSigned(p.lastSwing)}</td>
      <td class="num">${fmtInt(p.peak)}</td>
      <td class="num good-text">${p.goodWins}–${p.goodLosses}</td>
      <td class="num evil-text">${p.evilWins}–${p.evilLosses}</td>
      <td class="num">${fmtInt(p.aura)}</td>
    </tr>`).join("");
}

function renderTitleLadder() {
  const host = els.titleLadder;
  const draw = () => {
    const width = Math.max(320, host.clientWidth || 800);
    const people = state.model.players.filter(p => p.rated).sort((a, b) => a.chess - b.chess);
    const maxChess = Math.max(3000, ...people.map(p => p.chess + 120));
    const margin = { left: 12, right: 12 };
    const iw = width - margin.left - margin.right;
    const x = v => margin.left + (v / maxChess) * iw;
    const bandTop = 26;
    const bandHeight = 26;
    const radius = width < 600 ? 6 : 8;
    const rows = [];
    const placed = people.map(p => {
      const px = x(p.chess);
      let row = rows.findIndex(last => px - last > radius * 2 + 3);
      if (row < 0) { rows.push(px); row = rows.length - 1; } else rows[row] = px;
      return { p, px, row };
    });
    const height = bandTop + bandHeight + 22 + rows.length * (radius * 2 + 4) + 10;
    const bands = CHESS_TITLES.map(([cutoff, name], index) => {
      const end = CHESS_TITLES[index + 1]?.[0] ?? maxChess;
      const x0 = x(cutoff);
      const x1 = x(Math.min(end, maxChess));
      const wide = x1 - x0 > 34;
      return `<g class="band band-${index}"><rect x="${x0}" y="${bandTop}" width="${Math.max(0, x1 - x0 - 1)}" height="${bandHeight}" rx="3"/>${wide ? `<text x="${(x0 + x1) / 2}" y="${bandTop + 17}" text-anchor="middle">${escapeHtml(name)}</text>` : ""}<text class="band-cut" x="${x0 + 2}" y="${bandTop - 8}">${cutoff}</text></g>`;
    }).join("");
    const dots = placed.map(({ p, px, row }) => {
      const cy = bandTop + bandHeight + 18 + row * (radius * 2 + 4) + radius;
      return `<g class="ladder-dot ${legendClass(p.name)} ${p.onLeaderboard ? "" : "is-unlisted"}" data-player="${escapeHtml(p.name)}" data-tip="${escapeHtml(`${p.name}\n${fmtInt(p.chess)} chess · ${p.title}\n${plural(p.games, "game")}`)}" tabindex="0" role="button"><line x1="${px}" x2="${px}" y1="${bandTop + bandHeight}" y2="${cy}"/><circle cx="${px}" cy="${cy}" r="${radius}"/><text x="${px}" y="${cy + 3.5}" text-anchor="middle">${escapeHtml(p.name.charAt(0))}</text></g>`;
    }).join("");
    host.innerHTML = `<svg class="ladder-svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Players placed on the chess title ladder">${bands}${dots}</svg>`;
    bindTips(host);
  };
  registerChart(host, draw);
}

/* ---------------------------------------------------------------- tiers */

function renderTiers() {
  const m = state.model;
  els.rookieTiers.innerHTML = tierRows(m.rookies, p => tierChip(p, `${fmtInt(p.chess)}`, `${p.wins}–${p.losses} · debut ${shortDate(p.debutGame.date)}`, `${p.name}\nElo percentile ${fmtPct(p.percentile)}\nBase ${fmtInt(p.elo)}${p.provisional ? ` (95%: ${fmtInt(p.rangeLow)}–${fmtInt(p.rangeHigh)})` : ""}`));
  els.upsetTiers.innerHTML = tierRows(m.upsets, p => tierChip(p, fmtPct(p.upsetRate), `${p.upsetWins} of ${p.underdogGames} as underdog`, `${p.name}\n${p.upsetWins} upset wins in ${p.underdogGames} underdog games\nBase Elo ${fmtInt(p.elo)}`));
  els.duoTiers.innerHTML = tierRows(m.duoBoard, d => `
    <span class="chip chip-duo" role="button" tabindex="0" data-duo="${escapeHtml(`${d.a}|${d.b}`)}" data-tip="${escapeHtml(`${d.name}\n${d.wins}–${d.losses} together (${fmtPct(d.winRate)})\nElo expected ${fmtPct(d.expectedRate)}`)}">
      <span class="duo-sigils">${sigilSvg(d.a, 26)}${sigilSvg(d.b, 26)}</span>
      <span class="chip-text"><strong>${escapeHtml(d.a)} + ${escapeHtml(d.b)}</strong><small>${d.wins}–${d.losses} · ${fmtPct(d.winRate)}</small></span>
      <span class="chip-badge ${d.vsExpected >= 0 ? "up" : "down"}">${fmtSigned(d.vsExpected)}</span>
    </span>`);
  [els.rookieTiers, els.upsetTiers, els.duoTiers].forEach(bindTips);
}

function tierRows(items, chip) {
  if (!items.length) return `<p class="empty-state">Not enough games yet.</p>`;
  return ["S", "A", "B", "C", "D", "F"].map(tier => {
    const members = items.filter(item => item.tier === tier);
    return `<div class="tier-row tier-${tier.toLowerCase()} ${members.length ? "" : "is-empty"}"><span class="tier-label">${tier}</span><div class="tier-chips">${members.map(chip).join("") || `<span class="tier-none">—</span>`}</div></div>`;
  }).join("");
}

function tierChip(p, value, sub, tip) {
  return `<span class="chip ${legendClass(p.name)}" role="button" tabindex="0" data-player="${escapeHtml(p.name)}" data-tip="${escapeHtml(tip)}">${sigilSvg(p.name, 28)}<span class="chip-text"><strong>${escapeHtml(p.name)}</strong><small>${escapeHtml(sub)}</small></span><span class="chip-value">${escapeHtml(value)}</span></span>`;
}

/* ---------------------------------------------------------------- players */

function renderRoster() {
  const query = clean(els.playerSearch.value).toLowerCase();
  const sort = els.playerSort.value;
  const people = state.stats
    .filter(s => s.games + s.travelsGood + s.travelsEvil > 0 || player(s.player)?.rated)
    .map(s => ({ s, p: player(s.player) }))
    .filter(({ s }) => !query || s.player.toLowerCase().includes(query) || [...s.roles.keys()].some(role => role.toLowerCase().includes(query)));
  const recent = ({ p }) => p?.lastIndex ?? -1;
  people.sort((a, b) => {
    if (sort === "name") return a.s.player.localeCompare(b.s.player);
    if (sort === "games") return (b.p?.games || 0) - (a.p?.games || 0) || a.s.player.localeCompare(b.s.player);
    if (sort === "aura") return (b.p?.aura || 0) - (a.p?.aura || 0) || (b.p?.elo || 0) - (a.p?.elo || 0);
    if (sort === "winRate") return (b.p?.winRate ?? -1) - (a.p?.winRate ?? -1) || (b.p?.games || 0) - (a.p?.games || 0);
    if (sort === "recent") return recent(b) - recent(a) || a.s.player.localeCompare(b.s.player);
    return (b.p?.rated ? 1 : 0) - (a.p?.rated ? 1 : 0) || (b.p?.onLeaderboard ? 1 : 0) - (a.p?.onLeaderboard ? 1 : 0) || (b.p?.elo || 0) - (a.p?.elo || 0);
  });
  els.rosterGrid.innerHTML = people.map(({ s, p }) => {
    const rated = p?.rated;
    const badges = [p?.rank ? `<span class="badge">#${p.rank} Elo</span>` : "", p?.auraRank ? `<span class="badge badge-aura">#${p.auraRank} Aura</span>` : "", rated && !p.onLeaderboard ? `<span class="badge badge-muted">Unlisted</span>` : ""].join("");
    return `
      <article class="player-card ${legendClass(s.player)}" role="button" tabindex="0" data-player="${escapeHtml(s.player)}">
        <div class="player-card-top">
          ${sigilSvg(s.player, 56)}
          <div>
            <h3>${escapeHtml(s.player)}</h3>
            <p>${rated ? escapeHtml(p.title) : "Traveller"}${s.storyteller ? ` · ST ×${s.storyteller}` : ""}</p>
          </div>
          <div class="player-card-elo">${rated ? `<strong>${fmtInt(p.chess)}</strong><small>chess</small>` : `<strong>—</strong><small>unrated</small>`}</div>
        </div>
        <div class="player-card-spark" data-spark="${escapeHtml(s.player)}"></div>
        <div class="player-card-meta">
          <span>${rated ? `${plural(p.games, "game")} · ${p.wins}–${p.losses}` : plural(s.travelsGood + s.travelsEvil, "travel")}</span>
          <span class="badges">${badges}</span>
        </div>
      </article>`;
  }).join("") || `<p class="empty-state">No players match “${escapeHtml(query)}”.</p>`;
  els.rosterGrid.querySelectorAll("[data-spark]").forEach(node => {
    const p = player(node.dataset.spark);
    renderSparkline(node, p, legendColor(node.dataset.spark));
  });
}

/* ---------------------------------------------------------------- games */

function renderGameFilters() {
  const games = getAllGames();
  fillSelect(els.scriptFilter, "All scripts", [...new Set(games.map(game => game.script).filter(Boolean))].sort());
  fillSelect(els.formatFilter, "All formats", [...new Set(games.map(game => game.format).filter(Boolean))].sort());
}

function fillSelect(select, allLabel, values) {
  const current = select.value;
  select.innerHTML = `<option value="">${allLabel}</option>${values.map(value => `<option>${escapeHtml(value)}</option>`).join("")}`;
  select.value = values.includes(current) ? current : "";
}

function filteredGames() {
  const script = els.scriptFilter.value;
  const format = els.formatFilter.value;
  const outcome = els.outcomeFilter.value;
  return getAllGames().filter(game => (!script || game.script === script) && (!format || game.format === format) && (!outcome || game.outcome === outcome));
}

function renderGames() {
  const rows = filteredGames().sort((a, b) => compareDates(b.date, a.date) || gameNumber(b) - gameNumber(a));
  els.gameTableBody.innerHTML = rows.map(game => {
    const row = state.model.gameById.get(game.id);
    return `
      <tr data-game="${escapeHtml(game.id)}" tabindex="0">
        <td class="num muted">${row ? row.number : "—"}</td>
        <td>${escapeHtml(shortDate(game.date))}</td>
        <td><span class="tag ${game.outcome === "Good" ? "tag-good" : "tag-evil"}">${escapeHtml(game.outcome)}</span>${row?.upset ? ` <span class="tag tag-upset" title="The Elo underdog won">Upset</span>` : ""}</td>
        <td>${escapeHtml(game.script || "—")}</td>
        <td class="forecast-cell">${row ? forecastBar(row, true) : "—"}</td>
        <td class="num">${game.playerCount || countParticipants(game)}</td>
        <td>${escapeHtml(game.format || "—")}</td>
        <td>${escapeHtml(game.storyteller || "—")}</td>
      </tr>`;
  }).join("") || `<tr><td colspan="8" class="empty-state">No games match these filters.</td></tr>`;
  renderGamesTimeline(rows);
  renderIssues();
}

function gameNumber(game) {
  return state.model.gameById.get(game.id)?.number || 0;
}

function forecastBar(row, compact = false) {
  const pGood = row.pNumber;
  const winner = row.winSide === 1 ? "good" : "evil";
  return `<div class="forecast ${compact ? "forecast-compact" : ""}" title="Elo forecast: Good ${fmtPct(pGood)}, Evil ${fmtPct(1 - pGood)}">
    <div class="forecast-bar"><i class="fg" style="--w:${(pGood * 100).toFixed(1)}%"></i><i class="fe"></i><b class="forecast-mark winner-${winner}" style="--x:${(row.winSide === 1 ? pGood * 50 : 50 + pGood * 50).toFixed(1)}%"></b></div>
    <div class="forecast-labels"><span class="good-text">${fmtPct(pGood)}</span><span class="evil-text">${fmtPct(1 - pGood)}</span></div>
  </div>`;
}

function renderGamesTimeline(visibleGames) {
  const host = els.gamesTimeline;
  const visible = new Set(visibleGames.map(game => game.id));
  const draw = () => {
    const rows = state.model.games;
    const style = getComputedStyle(host);
    const inner = host.clientWidth - parseFloat(style.paddingLeft || 0) - parseFloat(style.paddingRight || 0);
    const width = Math.max(300, inner || 800);
    const height = 190;
    const m = { top: 26, bottom: 26, left: 40, right: 12 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const n = rows.length;
    const x = i => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = p => m.top + (1 - p) * ih;
    const mid = y(0.5);
    const stems = rows.map((row, i) => {
      const cx = x(i);
      const cy = y(row.pNumber);
      const cls = `${row.winSide === 1 ? "won-good" : "won-evil"} ${row.upset ? "is-upset" : ""} ${visible.has(row.game.id) ? "" : "is-dim"}`;
      return `<g class="tl-game ${cls}" data-game="${escapeHtml(row.game.id)}" tabindex="0" role="button" data-tip="${escapeHtml(`#${row.number} · ${shortDate(row.game.date)} · ${row.game.script}\nForecast: Good ${fmtPct(row.pNumber)}\n${row.game.outcome} won${row.upset ? " (upset)" : ""}`)}"><line x1="${cx}" x2="${cx}" y1="${mid}" y2="${cy}"/><circle cx="${cx}" cy="${cy}" r="${n > 60 ? 4 : 6}"/><rect x="${cx - iw / n / 2}" y="${m.top}" width="${iw / Math.max(1, n)}" height="${ih}" fill="transparent"/></g>`;
    }).join("");
    const years = [];
    rows.forEach((row, i) => {
      const year = fullYear(row.game.date);
      if (!years.length || years.at(-1).year !== year) years.push({ year, i });
    });
    host.innerHTML = `
      <div class="timeline-head"><p class="eyebrow">Forecast vs. result</p><p class="section-copy">Up: Elo favoured Good. Colour: winner. Ring: upset.</p></div>
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="timeline-svg" role="img" aria-label="Elo forecast and result for every game">
        <text class="axis-label" x="${m.left - 8}" y="${y(1) + 4}" text-anchor="end">Good</text>
        <text class="axis-label" x="${m.left - 8}" y="${mid + 4}" text-anchor="end">50%</text>
        <text class="axis-label" x="${m.left - 8}" y="${y(0) + 4}" text-anchor="end">Evil</text>
        <line class="axis-mid" x1="${m.left}" x2="${width - m.right}" y1="${mid}" y2="${mid}"/>
        ${years.map(({ year, i }) => `<text class="axis-label" x="${x(i)}" y="${height - 6}" text-anchor="start">${year}</text><line class="axis-year" x1="${x(i)}" x2="${x(i)}" y1="${m.top}" y2="${height - m.bottom}"/>`).join("")}
        ${stems}
      </svg>`;
    bindTips(host);
  };
  registerChart(host, draw);
}

function renderIssues() {
  if (!state.issues.length) {
    els.issuesPanel.innerHTML = "";
    return;
  }
  els.issuesPanel.innerHTML = `
    <details class="panel">
      <summary><span class="eyebrow">Data QA</span> ${state.issues.length} note${state.issues.length === 1 ? "" : "s"} on the source sheet</summary>
      <ul>${state.issues.map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}</ul>
    </details>`;
}

/* ---------------------------------------------------------------- statistics */

function renderStatistics() {
  renderOracle();
  renderLookupControls();
  renderLookup();
  renderScriptBreakdown();
  renderRoleBreakdown();
}

function seedOracle() {
  state.oracle.clear();
  state.oracle.set(LEGENDS.day, "Good");
  state.oracle.set(LEGENDS.night, "Evil");
}

function randomOracle() {
  const pool = state.model.leaderboard.map(p => p.name);
  shuffle(pool);
  const size = Math.min(pool.length, 7 + Math.floor(Math.random() * 6));
  const evilCount = size >= 13 ? 4 : size >= 10 ? 3 : 2;
  state.oracle.clear();
  pool.slice(0, size).forEach((name, index) => state.oracle.set(name, index < evilCount ? "Evil" : "Good"));
}

function renderOracle() {
  const pool = state.model.players.filter(p => p.rated).sort((a, b) => b.elo - a.elo || a.slot - b.slot);
  els.oraclePool.innerHTML = pool.map(p => {
    const side = state.oracle.get(p.name) || "";
    return `<button type="button" class="oracle-chip ${side ? `is-${side.toLowerCase()}` : ""}" data-oracle="${escapeHtml(p.name)}" aria-pressed="${side ? "true" : "false"}">${sigilSvg(p.name, 22)}<span>${escapeHtml(p.name)}</span><small>${fmtInt(p.chess)}</small></button>`;
  }).join("");
  const good = [...state.oracle].filter(([, side]) => side === "Good").map(([name]) => name);
  const evil = [...state.oracle].filter(([, side]) => side === "Evil").map(([name]) => name);
  if (!good.length || !evil.length) {
    els.oracleResult.innerHTML = `<div class="oracle-empty"><svg viewBox="0 0 80 80" aria-hidden="true"><circle cx="40" cy="40" r="30" fill="none" stroke="currentColor" stroke-width="1.5" stroke-dasharray="3 5"/><circle cx="40" cy="40" r="6" fill="currentColor"/></svg><p>Put at least one player on each team.</p></div>`;
    return;
  }
  const preview = previewMatchup(state.model, good, evil);
  const team = (names, side, change) => names.map(name => {
    const p = player(name);
    return `<li>${sigilSvg(name, 22)}<span>${escapeHtml(name)}</span><small>${fmtInt(p?.chess ?? 1500)}</small><b class="${change >= 0 ? "up" : "down"}">${fmtSigned(change)}</b></li>`;
  }).join("");
  const pGood = preview.pGood;
  els.oracleResult.innerHTML = `
    <div class="oracle-gauge">${gaugeSvg(pGood)}</div>
    <div class="oracle-split">
      <div class="oracle-team team-good">
        <h4><span class="tag tag-good">Good</span> ${good.length} · avg ${fmtInt(preview.goodAvg)}</h4>
        <p class="oracle-if">If Good wins: <b class="up">${fmtSigned(preview.ifGood.goodChange)}</b> each</p>
        <ul>${team(good, "Good", preview.ifGood.goodChange)}</ul>
      </div>
      <div class="oracle-team team-evil">
        <h4><span class="tag tag-evil">Evil</span> ${evil.length} · avg ${fmtInt(preview.evilAvg)}</h4>
        <p class="oracle-if">If Evil wins: <b class="up">${fmtSigned(preview.ifEvil.evilChange)}</b> each</p>
        <ul>${team(evil, "Evil", preview.ifEvil.evilChange)}</ul>
      </div>
    </div>
`;
}

function gaugeSvg(pGood) {
  const angle = Math.PI * (1 - pGood);
  const cx = 120;
  const cy = 118;
  const r = 92;
  const arc = (a0, a1) => {
    const x0 = cx + r * Math.cos(a0);
    const y0 = cy - r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1);
    const y1 = cy - r * Math.sin(a1);
    return `M${x0.toFixed(2)} ${y0.toFixed(2)} A${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  const nx = cx + (r - 14) * Math.cos(angle);
  const ny = cy - (r - 14) * Math.sin(angle);
  return `<svg viewBox="0 0 240 150" role="img" aria-label="Good win chance ${fmtPct(pGood)}">
    <path d="${arc(Math.PI, angle)}" class="gauge-good"/>
    <path d="${arc(angle, 0)}" class="gauge-evil"/>
    <line x1="${cx}" y1="${cy}" x2="${nx.toFixed(2)}" y2="${ny.toFixed(2)}" class="gauge-needle"/>
    <circle cx="${cx}" cy="${cy}" r="6" class="gauge-hub"/>
    <text x="22" y="142" class="gauge-label good-fill">Good ${fmtPct(pGood)}</text>
    <text x="218" y="142" text-anchor="end" class="gauge-label evil-fill">Evil ${fmtPct(1 - pGood)}</text>
  </svg>`;
}

function renderLookupControls() {
  const currentPlayer = els.statsPlayer.value;
  const currentRole = els.statsRole.value;
  const active = state.stats.filter(s => s.games > 0).sort((a, b) => a.player.localeCompare(b.player));
  const roles = [...new Set(state.stats.flatMap(s => [...s.roles.keys()]))].sort((a, b) => a.localeCompare(b));
  els.statsPlayer.innerHTML = `<option value="">Choose a player</option>${active.map(s => `<option value="${escapeHtml(s.player)}">${escapeHtml(s.player)}</option>`).join("")}`;
  els.statsRole.innerHTML = `<option value="">Choose a character</option>${roles.map(role => `<option value="${escapeHtml(role)}">${escapeHtml(role)}</option>`).join("")}`;
  els.statsPlayer.value = currentPlayer;
  els.statsRole.value = currentRole;
}

function renderLookup() {
  const name = els.statsPlayer.value;
  const role = els.statsRole.value;
  if (name) {
    const s = stat(name);
    if (!s) return;
    els.statisticsResults.innerHTML = lookupCard(`${escapeHtml(s.player)}’s record`, s.games, s.wins, s.losses, s.success, s.goodWinrate, s.evilWinrate)
      + `<button class="button button-ghost" type="button" data-player="${escapeHtml(s.player)}">Open full profile</button>`;
    return;
  }
  if (role) {
    const entries = state.stats.flatMap(s => s.history.filter(entry => entry.role === role && !entry.isTraveler).map(entry => ({ ...entry, name: s.player })));
    const wins = entries.filter(entry => entry.result === "Win").length;
    const good = entries.filter(entry => entry.alignment === "Good");
    const evil = entries.filter(entry => entry.alignment === "Evil");
    const playedBy = countBy(entries.map(entry => entry.name));
    els.statisticsResults.innerHTML = lookupCard(`The ${escapeHtml(role)}`, entries.length, wins, entries.length - wins, ratio(wins, entries.length), ratio(good.filter(e => e.teamResult === "Win").length, good.length), ratio(evil.filter(e => e.teamResult === "Win").length, evil.length))
      + `<div class="chip-cloud">${[...playedBy.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([who, count]) => `<span class="chip chip-small" role="button" tabindex="0" data-player="${escapeHtml(who)}">${sigilSvg(who, 20)}<span class="chip-text"><strong>${escapeHtml(who)}</strong></span><span class="chip-value">${count}</span></span>`).join("")}</div>`;
    return;
  }
  els.statisticsResults.innerHTML = `<p class="section-copy">Choose a player or character.</p>`;
}

function lookupCard(title, games, wins, losses, winrate, goodRate, evilRate) {
  return `<h4>${title}</h4><div class="mini-grid"><article><span>Games</span><strong>${games}</strong></article><article><span>Record</span><strong>${wins}–${losses}</strong></article><article><span>Win rate</span><strong>${fmtPct(winrate, 1)}</strong></article><article><span>Good / Evil</span><strong><span class="good-text">${fmtPct(goodRate)}</span> / <span class="evil-text">${fmtPct(evilRate)}</span></strong></article></div>`;
}

function renderScriptBreakdown() {
  const scripts = new Map();
  state.model.games.forEach(row => {
    const name = row.game.script || "Unknown";
    const entry = scripts.get(name) || { name, games: 0, good: 0, expected: 0, upsets: 0 };
    entry.games += 1;
    if (row.winSide === 1) entry.good += 1;
    entry.expected += row.pNumber;
    if (row.upset) entry.upsets += 1;
    scripts.set(name, entry);
  });
  els.scriptBreakdown.innerHTML = [...scripts.values()].sort((a, b) => b.games - a.games).map(entry => {
    const goodRate = entry.good / entry.games;
    return `<div class="script-row">
      <div class="script-name"><strong>${escapeHtml(entry.name)}</strong><small>${entry.games} game${entry.games === 1 ? "" : "s"} · ${entry.upsets} upset${entry.upsets === 1 ? "" : "s"}</small></div>
      <div class="split-bar" title="Good won ${entry.good} of ${entry.games}"><i class="fg" style="--w:${(goodRate * 100).toFixed(1)}%"><span>${entry.good}</span></i><i class="fe"><span>${entry.games - entry.good}</span></i><b class="expect" style="--x:${((entry.expected / entry.games) * 100).toFixed(1)}%" title="Elo expected Good ${fmtPct(entry.expected / entry.games)}"></b></div>
    </div>`;
  }).join("") + `<p class="footnote"><span class="good-text">Good</span> / <span class="evil-text">Evil</span> wins. Tick: average Elo forecast for Good.</p>`;
}

function renderRoleBreakdown() {
  const roles = new Map();
  state.stats.forEach(s => s.history.forEach(entry => {
    if (!entry.role || entry.isTraveler) return;
    const item = roles.get(entry.role) || { role: entry.role, count: 0, wins: 0, alignment: roleAlignment(entry.role) || entry.alignment };
    item.count += 1;
    if (entry.result === "Win") item.wins += 1;
    roles.set(entry.role, item);
  }));
  const list = [...roles.values()].sort((a, b) => b.count - a.count || a.role.localeCompare(b.role)).slice(0, 24);
  const max = list[0]?.count || 1;
  els.roleBreakdown.innerHTML = list.map(item => `
    <button type="button" class="role-row" data-role-lookup="${escapeHtml(item.role)}">
      <span class="role-name ${item.alignment === "Evil" ? "evil-text" : "good-text"}">${escapeHtml(item.role)}${DEMON_ROLES.has(item.role) ? ` <small>Demon</small>` : ""}</span>
      <span class="role-bar" style="--w:${((item.count / max) * 100).toFixed(1)}%"><i class="win" style="--w:${((item.wins / item.count) * 100).toFixed(1)}%"></i></span>
      <span class="role-count">${item.count}<small>${fmtPct(item.wins / item.count)} won</small></span>
    </button>`).join("");
  els.roleBreakdown.querySelectorAll("[data-role-lookup]").forEach(button => button.addEventListener("click", () => {
    els.statsPlayer.value = "";
    els.statsRole.value = button.dataset.roleLookup;
    renderLookup();
    els.statisticsResults.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
  }));
}

/* ---------------------------------------------------------------- about */

function renderAbout() {
  const games = getAllGames();
  const first = games[0];
  const people = state.stats.filter(s => s.games + s.travelsGood + s.travelsEvil > 0).length;
  const formats = new Set(games.map(game => game.format).filter(Boolean));
  els.aboutCopy.textContent = `The Ψ Press is an invite-only UChicago-based group that plays Blood on the Clocktower approximately twice a month. We first started playing on ${first ? longDate(first.date) : "January 25th, 2025"}, and have run ${numberWords(games.length)} games with a rotating cast of ${numberWords(people)} participants${formats.size > 1 ? ", through both online and in-person formats" : ""}.`;
  const storytellers = countBy(games.flatMap(game => splitNames(game.storyteller)));
  const topSt = [...storytellers.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  const online = games.filter(game => game.format === "Online").length;
  els.aboutFacts.innerHTML = `
    <p class="eyebrow">By the numbers</p>
    <dl class="facts">
      <div><dt>First game</dt><dd>${first ? escapeHtml(longDate(first.date)) : "—"}</dd></div>
      <div><dt>Games</dt><dd>${games.length}</dd></div>
      <div><dt>Participants</dt><dd>${people}</dd></div>
      <div><dt>In person / online</dt><dd>${games.length - online} / ${online}</dd></div>
      <div><dt>Scripts</dt><dd>${escapeHtml([...new Set(games.map(game => game.script).filter(Boolean))].join(", "))}</dd></div>
      <div><dt>Most frequent storytellers</dt><dd>${topSt.map(([name, count]) => `${escapeHtml(name)} (${count})`).join(", ")}</dd></div>
    </dl>`;
  els.titleTable.innerHTML = `<table class="data-table compact"><thead><tr><th class="num">Chess Elo</th><th>Title</th><th class="num">Base Elo needed</th><th>Players</th></tr></thead><tbody>${CHESS_TITLES.map(([cutoff, title], index) => {
    const next = CHESS_TITLES[index + 1]?.[0] ?? Infinity;
    const holders = state.model.leaderboard.filter(p => p.chess >= cutoff && p.chess < next).map(p => p.name);
    const base = RATING_SETTINGS.start + (cutoff - RATING_SETTINGS.chessAverage) / RATING_SETTINGS.chessStretch;
    return `<tr><td class="num">${cutoff}</td><td>${escapeHtml(TITLE_NAMES[title] ? `${title} (${TITLE_NAMES[title]})` : title)}</td><td class="num">${cutoff === 0 ? "—" : fmtInt(base)}</td><td>${holders.map(escapeHtml).join(", ") || "—"}</td></tr>`;
  }).join("")}</tbody></table>`;
  const cut = list => list.map(value => `${Math.round(value * 100)}%`);
  els.cutoffTable.innerHTML = `<table class="data-table compact"><thead><tr><th>List</th><th class="num">S</th><th class="num">A</th><th class="num">B</th><th class="num">C</th><th class="num">D</th></tr></thead><tbody>
    <tr><td>Rookies (Elo percentile)</td>${cut(TIER_CUTOFFS.elo).map(v => `<td class="num">${v}</td>`).join("")}</tr>
    <tr><td>Upsets (upset win %)</td>${cut(TIER_CUTOFFS.upset).map(v => `<td class="num">${v}</td>`).join("")}</tr>
    <tr><td>Duos (win % together)</td>${cut(TIER_CUTOFFS.duo).map(v => `<td class="num">${v}</td>`).join("")}</tr>
  </tbody></table>`;
}

/* ---------------------------------------------------------------- dialogs */

function openPlayerDialog(name, options = {}) {
  const p = player(name);
  const s = stat(name);
  if (!p && !s) return;
  const display = p?.name || s.player;
  if (els.gameDialog.open) els.gameDialog.close();
  if (els.infoDialog.open) els.infoDialog.close();
  els.playerDialogHeading.innerHTML = `
    ${sigilSvg(display, 64)}
    <div>
      <p class="eyebrow">${p?.rated ? `${escapeHtml(TITLE_NAMES[p.title] || p.title)}${p.rank ? ` · #${p.rank} Elo` : ""}${p.auraRank ? ` · #${p.auraRank} Aura` : ""}` : "Traveller"}</p>
      <h2 id="playerDialogName">${escapeHtml(display)}</h2>
    </div>`;
  els.playerDialogContent.innerHTML = renderProfile(p, s);
  if (!options.fromRoute) setHash(`#player/${encodeURIComponent(display)}`);
  if (!els.playerDialog.open) els.playerDialog.showModal();
  els.playerDialog.querySelector(".dialog-body").scrollTop = 0;
  const chartHost = els.playerDialogContent.querySelector(".profile-chart");
  if (chartHost && p?.rated) {
    const series = [eloSeries(display, legendColor(display))];
    requestAnimationFrame(() => drawEloChart(chartHost, series, { height: 240, onlyPlayed: true }));
  }
  bindTips(els.playerDialogContent);
}

function renderProfile(p, s) {
  const rated = p?.rated;
  const nt = rated ? nextTitle(p.chess) : null;
  const tiles = rated ? [
    profileTile("Chess Elo", fmtInt(p.chess), `${escapeHtml(p.title)} · base ${fmtInt(p.elo)}`),
    profileTile("Aura", fmtInt(p.aura), p.auraRank ? `#${p.auraRank} all-time` : p.aura > 0 ? `needs ${RATING_SETTINGS.leaderboardMin} games to list` : "Elo below start"),
    profileTile("Record", `${p.wins}–${p.losses}`, `${fmtPct(p.winRate)} win rate`),
    profileTile("Peak", fmtInt(p.chessPeak), `base ${fmtInt(p.peak)}`),
    profileTile("Last swing", fmtSigned(p.lastSwing), p.timeline.length ? shortDate(p.timeline.at(-1).game.date) : ""),
    p.provisional
      ? profileTile("95% range", `${fmtInt(p.rangeLow)}–${fmtInt(p.rangeHigh)}`, `provisional under ${RATING_SETTINGS.provisionalGames} games`)
      : profileTile("Upsets", p.underdogGames ? `${p.upsetWins}/${p.underdogGames}` : "—", p.underdogGames ? `${fmtPct(p.upsetRate)} as underdog` : "never the underdog"),
  ].join("") : "";
  const nextLine = rated && nt ? `<p class="profile-next">${fmtInt(nt[0] - p.chess)} chess points (≈${fmtInt((nt[0] - p.chess) / RATING_SETTINGS.chessStretch)} base) from <strong>${escapeHtml(nt[1])}</strong>.</p>` : rated ? `<p class="profile-next">At the top of the title ladder.</p>` : "";

  const classic = s ? [
    ["Games played", s.games], ["Evil travels", s.travelsEvil], ["Good travels", s.travelsGood], ["Wins", s.wins], ["Losses", s.losses],
    ["Success %", fmtPct(s.success, 1)], ["Evil games", s.evilGames], ["Evil wins", s.evilWins], ["Evil losses", s.evilLosses],
    ["Evil win rate", fmtPct(s.evilWinrate)], ["Evil frequency", fmtPct(s.evilFrequency)], ["Good games", s.goodGames], ["Good wins", s.goodWins],
    ["Good losses", s.goodLosses], ["Good win rate", fmtPct(s.goodWinrate)], ["Good frequency", fmtPct(s.goodFrequency)], ["Storyteller", s.storyteller],
  ] : [];
  const roles = s ? [...s.roles.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])) : [];
  const partners = rated ? state.model.duos.filter(d => nameKey(d.a) === nameKey(p.name) || nameKey(d.b) === nameKey(p.name))
    .map(d => ({ ...d, other: nameKey(d.a) === nameKey(p.name) ? d.b : d.a }))
    .sort((a, b) => b.games - a.games || b.winRate - a.winRate).slice(0, 6) : [];
  const timeline = rated ? [...p.timeline].reverse() : [];
  const seatFor = game => getPlayerEntry(game, p?.name || s.player);
  const extra = s ? s.history.filter(entry => entry.isTraveler).map(entry => entry.game) : [];

  return `
    ${rated ? `<section class="profile-tiles">${tiles}</section>${nextLine}` : `<p class="section-copy">Travelled only, so unrated.</p>`}
    ${rated ? `<section class="profile-section"><h3>Rating history</h3><div class="profile-chart chart-host"></div></section>` : ""}
    <section class="profile-columns">
      <div class="profile-section">
        <h3>Characters</h3>
        <div class="chip-cloud">${roles.map(([role, count]) => `<span class="role-chip ${roleAlignment(role) === "Evil" ? "is-evil" : "is-good"}${DEMON_ROLES.has(role) ? " is-demon" : ""}">${escapeHtml(role)}${count > 1 ? ` <b>×${count}</b>` : ""}</span>`).join("") || `<span class="section-copy">No roles recorded.</span>`}</div>
        ${partners.length ? `<h3>Most frequent teammates</h3><ul class="partner-list">${partners.map(d => `<li role="button" tabindex="0" data-duo="${escapeHtml(`${d.a}|${d.b}`)}">${sigilSvg(d.other, 24)}<span>${escapeHtml(d.other)}</span><small>${d.wins}–${d.losses} together</small><b class="${d.vsExpected >= 0 ? "up" : "down"}">${fmtSigned(d.vsExpected)} vs exp.</b></li>`).join("")}</ul>` : ""}
      </div>
      <div class="profile-section">
        <h3>Spreadsheet stats</h3>
        <dl class="stat-list">${classic.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>
      </div>
    </section>
    ${rated ? `<section class="profile-section"><h3>Game by game</h3><div class="table-shell"><table class="data-table compact"><thead><tr><th>Date</th><th>Script</th><th>Character</th><th>Team</th><th>Result</th><th>Team chance</th><th>Elo</th></tr></thead><tbody>
      ${timeline.map(t => {
        const seat = seatFor(t.game);
        return `<tr data-game="${escapeHtml(t.game.id)}" tabindex="0"><td>${escapeHtml(shortDate(t.game.date))}</td><td>${escapeHtml(t.game.script || "—")}</td><td>${escapeHtml(seat.role || "—")}</td><td><span class="tag ${t.side === "Good" ? "tag-good" : "tag-evil"}">${t.side}</span></td><td>${t.won ? "Win" : "Loss"}${t.underdog && t.won ? ` <span class="tag tag-upset">Upset</span>` : ""}</td><td class="num">${fmtPct(t.teamChance)}</td><td class="num ${t.change >= 0 ? "up" : "down"}">${fmtSigned(t.change)} <small>→ ${fmtInt(t.after)}</small></td></tr>`;
      }).join("")}
      ${extra.map(game => `<tr data-game="${escapeHtml(game.id)}" tabindex="0"><td>${escapeHtml(shortDate(game.date))}</td><td>${escapeHtml(game.script || "—")}</td><td>${escapeHtml(seatFor(game).role)}</td><td colspan="4" class="muted">Travelling · unrated</td></tr>`).join("")}
    </tbody></table></div></section>` : ""}`;
}

function profileTile(label, value, sub) {
  return `<article class="profile-tile"><span>${escapeHtml(label)}</span><strong>${value}</strong><small>${sub}</small></article>`;
}

function openGameDialog(gameId, options = {}) {
  const game = getAllGames().find(item => item.id === gameId);
  if (!game) return;
  const row = state.model.gameById.get(game.id);
  els.gameDialogEyebrow.textContent = `${row ? `Game #${row.number} · ` : ""}${longDate(game.date)}`;
  els.gameDialogName.textContent = game.script || "Game";
  els.gameDialogContent.innerHTML = renderGameDialogContent(game, row);
  els.gameDialogContent.querySelector("[data-edit-game-detail]")?.addEventListener("click", () => requestEntryUnlock(game.id));
  els.gameDialogContent.querySelector("[data-delete-game-detail]")?.addEventListener("click", () => openDeleteDialog(game.id));
  if (!options.fromRoute) setHash(`#game/${encodeURIComponent(game.id)}`);
  if (els.playerDialog.open) els.playerDialog.close();
  if (els.infoDialog.open) els.infoDialog.close();
  if (!els.gameDialog.open) els.gameDialog.showModal();
  els.gameDialog.querySelector(".dialog-body").scrollTop = 0;
}

function renderGameDialogContent(game, row) {
  const participants = getGameParticipants(game);
  const seatRow = item => {
    const p = player(item.name);
    const slot = p?.slot;
    const ratedSide = row && slot !== undefined ? row.sides[slot] : 0;
    const change = ratedSide ? row.changes[slot] : null;
    return `<li role="button" tabindex="0" data-player="${escapeHtml(item.name)}">
      ${sigilSvg(item.name, 28)}
      <span class="seat-name"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.role || "—")}${item.isTraveler ? " · Traveller" : ""}</small></span>
      ${change !== null ? `<span class="seat-elo">${fmtInt(row.before[slot])} → ${fmtInt(row.after[slot])}</span><b class="${change >= 0 ? "up" : "down"}">${fmtSigned(change)}</b>` : `<span class="seat-elo muted">unrated</span><b></b>`}
    </li>`;
  };
  const goodTeam = participants.filter(item => item.alignment === "Good");
  const evilTeam = participants.filter(item => item.alignment === "Evil");
  const unknown = participants.filter(item => !item.alignment);
  const winnerChance = row ? (row.winSide === 1 ? row.pNumber : 1 - row.pNumber) : null;
  return `
    <section class="profile-tiles">
      ${profileTile("Winner", `<span class="${game.outcome === "Good" ? "good-text" : "evil-text"}">${escapeHtml(game.outcome)}</span>`, row?.upset ? "upset" : winnerChance !== null ? "favoured" : "")}
      ${profileTile("Players", String(game.playerCount || countParticipants(game)), row ? `${row.goodCount} Good · ${row.evilCount} Evil` : "")}
      ${profileTile("Final day", game.finalDay === "1" ? "Yes" : game.finalDay === "0" ? "No" : "—", "")}
      ${profileTile("Format", escapeHtml(game.format || "—"), "")}
      ${profileTile("Storyteller", escapeHtml(game.storyteller || "—"), "")}
      ${row ? profileTile("Swing cap", row.cap < 1 ? `×${row.cap.toFixed(2)}` : "none", "") : ""}
    </section>
    ${row ? `<section class="profile-section"><h3>Elo forecast</h3>${forecastBar(row)}<p class="section-copy">Average Elo going in: Good ${fmtInt(row.goodAvg)}, Evil ${fmtInt(row.evilAvg)}.</p></section>` : ""}
    <section class="team-columns">
      <div class="team team-good ${game.outcome === "Good" ? "is-winner" : ""}"><h3><span class="tag tag-good">Good</span>${game.outcome === "Good" ? " Winners" : ""}</h3><ul class="seat-list">${goodTeam.map(seatRow).join("") || `<li class="muted">Nobody recorded.</li>`}</ul></div>
      <div class="team team-evil ${game.outcome === "Evil" ? "is-winner" : ""}"><h3><span class="tag tag-evil">Evil</span>${game.outcome === "Evil" ? " Winners" : ""}</h3><ul class="seat-list">${evilTeam.map(seatRow).join("") || `<li class="muted">Nobody recorded.</li>`}</ul></div>
    </section>
    ${unknown.length ? `<section class="profile-section"><h3>Unknown team</h3><ul class="seat-list">${unknown.map(seatRow).join("")}</ul></section>` : ""}
    ${state.databaseAvailable ? `<div class="dialog-actions"><button class="button button-ghost" data-edit-game-detail="${escapeHtml(game.id)}" type="button">Edit game</button><button class="button button-danger" data-delete-game-detail="${escapeHtml(game.id)}" type="button">Delete game</button></div>` : ""}`;
}

function getGameParticipants(game) {
  const names = [];
  const seen = new Set();
  [...Object.keys(game.roles), ...game.winNames, ...game.lossNames].forEach(name => {
    if (seen.has(nameKey(name))) return;
    seen.add(nameKey(name));
    names.push(name);
  });
  return names.sort((a, b) => a.localeCompare(b)).map(name => {
    const entry = getPlayerEntry(game, name);
    return { name, role: entry.role, alignment: entry.alignment, result: entry.result, isTraveler: entry.isTraveler };
  });
}

function openDuoDialog(key) {
  const [a, b] = key.split("|");
  const h2h = headToHead(state.model, a, b);
  const duo = state.model.duos.find(d => (nameKey(d.a) === nameKey(a) && nameKey(d.b) === nameKey(b)) || (nameKey(d.a) === nameKey(b) && nameKey(d.b) === nameKey(a)));
  if (!h2h) return;
  els.infoDialogEyebrow.textContent = "Duo";
  els.infoDialogTitle.textContent = `${a} + ${b}`;
  const rows = h2h.games.map(g => `<tr data-game="${escapeHtml(g.row.game.id)}" tabindex="0"><td>${escapeHtml(shortDate(g.row.game.date))}</td><td>${escapeHtml(g.row.game.script)}</td><td>${g.kind === "together" ? `<span class="tag ${g.row.sides[player(a).slot] === 1 ? "tag-good" : "tag-evil"}">Together</span>` : "Opposed"}</td><td>${g.kind === "together" ? (g.won ? "Won" : "Lost") : `${escapeHtml(g.winner)} won`}</td></tr>`).join("");
  els.infoDialogContent.innerHTML = `
    <section class="profile-tiles">
      ${profileTile("Together", duo ? `${duo.wins}–${duo.losses}` : "0–0", duo ? `${fmtPct(duo.winRate)} win rate` : "")}
      ${profileTile("Elo expected", duo ? fmtPct(duo.expectedRate) : "—", duo ? `${fmtSigned(duo.vsExpected)} pts vs expected` : "")}
      ${profileTile("Opposed", `${h2h.aWins}–${h2h.bWins}`, `${escapeHtml(a)} – ${escapeHtml(b)}`)}
    </section>
    <div class="table-shell"><table class="data-table compact"><thead><tr><th>Date</th><th>Script</th><th>Teams</th><th>Result</th></tr></thead><tbody>${rows}</tbody></table></div>
    <div class="dialog-actions"><button class="button button-ghost" type="button" data-player="${escapeHtml(a)}">${escapeHtml(a)}</button><button class="button button-ghost" type="button" data-player="${escapeHtml(b)}">${escapeHtml(b)}</button></div>`;
  if (els.playerDialog.open) els.playerDialog.close();
  if (els.gameDialog.open) els.gameDialog.close();
  if (!els.infoDialog.open) els.infoDialog.showModal();
}

/* ---------------------------------------------------------------- charts */

function registerChart(host, draw) {
  const chart = charts.get(host) || { host, width: 0 };
  chart.draw = () => {
    chart.width = host.clientWidth;
    draw();
  };
  charts.set(host, chart);
  if (!chart.observed && typeof ResizeObserver !== "undefined") {
    chart.observed = true;
    new ResizeObserver(() => { if (host.offsetParent && Math.abs(host.clientWidth - chart.width) > 4) chart.draw(); }).observe(host);
  }
  chart.draw();
}

function drawEloChart(host, series, options = {}) {
  if (!host) return;
  registerChart(host, () => {
    if (!series.length) {
      host.innerHTML = `<p class="empty-state">No rating history yet.</p>`;
      return;
    }
    const width = Math.max(300, host.clientWidth || 640);
    const height = options.height || 300;
    const m = { top: 16, right: 16, bottom: 30, left: 46 };
    const iw = width - m.left - m.right;
    const ih = height - m.top - m.bottom;
    const n = series[0].values.length;
    const values = series.flatMap(s => s.values);
    let lo = Math.min(...values, RATING_SETTINGS.start);
    let hi = Math.max(...values, RATING_SETTINGS.start);
    const pad = Math.max(20, (hi - lo) * 0.08);
    lo -= pad;
    hi += pad;
    const x = i => m.left + (n <= 1 ? iw / 2 : (i / (n - 1)) * iw);
    const y = v => m.top + (1 - (v - lo) / (hi - lo)) * ih;
    const ticks = niceTicks(lo, hi, height < 260 ? 4 : 5);
    const games = state.model.games;
    const years = [];
    games.forEach((row, i) => {
      const year = fullYear(row.game.date);
      if (!years.length || years.at(-1).year !== year) years.push({ year, i: i + 1 });
    });
    host.dataset.cid ||= Math.random().toString(36).slice(2, 8);
    const cid = host.dataset.cid;
    const paths = series.map((s, index) => {
      const d = s.values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
      const area = `${d}L${x(n - 1).toFixed(1)} ${(m.top + ih).toFixed(1)}L${x(0).toFixed(1)} ${(m.top + ih).toFixed(1)}Z`;
      const dots = s.values.map((v, i) => (s.played[i] ? `<circle cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="3.2" style="fill:${s.color}"/>` : "")).join("");
      const last = s.values.at(-1);
      return `<g class="series" style="--c:${s.color}">
        <path d="${area}" class="series-area" fill="url(#grad-${index}-${cid})"/>
        <path d="${d}" class="series-line"/>
        ${dots}
        <text x="${(x(n - 1) - 6).toFixed(1)}" y="${(y(last) - 8).toFixed(1)}" text-anchor="end" class="series-label">${escapeHtml(s.name)}</text>
      </g>`;
    }).join("");
    const grads = series.map((s, index) => `<linearGradient id="grad-${index}-${cid}" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stop-color="${cssColor(s.color)}" stop-opacity=".22"/><stop offset="100%" stop-color="${cssColor(s.color)}" stop-opacity="0"/></linearGradient>`).join("");
    host.innerHTML = `
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" class="elo-chart" role="img" aria-label="Elo history for ${escapeHtml(series.map(s => s.name).join(" and "))}">
        <defs>${grads}</defs>
        ${ticks.map(t => `<g class="tick"><line x1="${m.left}" x2="${width - m.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}"/><text x="${m.left - 8}" y="${(y(t) + 4).toFixed(1)}" text-anchor="end">${fmtInt(t)}</text></g>`).join("")}
        <line class="start-line" x1="${m.left}" x2="${width - m.right}" y1="${y(RATING_SETTINGS.start).toFixed(1)}" y2="${y(RATING_SETTINGS.start).toFixed(1)}"/>
        <text class="start-label" x="${m.left + 4}" y="${(y(RATING_SETTINGS.start) - 5).toFixed(1)}">start ${RATING_SETTINGS.start}</text>
        ${years.map(({ year, i }) => `<text class="axis-label" x="${x(i).toFixed(1)}" y="${height - 8}" text-anchor="middle">${year}</text>`).join("")}
        ${paths}
        <line class="crosshair" x1="0" x2="0" y1="${m.top}" y2="${m.top + ih}" visibility="hidden"/>
        <rect class="hit" x="${m.left}" y="${m.top}" width="${iw}" height="${ih}" fill="transparent"/>
      </svg>`;
    const svg = host.querySelector("svg");
    const cross = svg.querySelector(".crosshair");
    const hit = svg.querySelector(".hit");
    const move = event => {
      const rect = svg.getBoundingClientRect();
      const px = event.clientX - rect.left;
      const i = Math.max(0, Math.min(n - 1, Math.round(((px - m.left) / iw) * (n - 1))));
      cross.setAttribute("x1", x(i));
      cross.setAttribute("x2", x(i));
      cross.setAttribute("visibility", "visible");
      const row = i > 0 ? games[i - 1] : null;
      const lines = series.map(s => {
        const played = s.played[i];
        const change = row && played ? row.changes[s.slot] : null;
        return `<span class="tip-row"><i style="background:${s.color}"></i>${escapeHtml(s.name)} <b>${fmtInt(s.values[i])}</b>${change !== null ? ` <em class="${change >= 0 ? "up" : "down"}">${fmtSigned(change)}</em>` : ""}</span>`;
      }).join("");
      showTip(`${row ? `<strong>#${row.number} · ${escapeHtml(shortDate(row.game.date))}</strong><span class="tip-sub">${escapeHtml(row.game.script)} · ${escapeHtml(row.game.outcome)} won</span>` : `<strong>Start</strong>`}${lines}`, event.clientX, event.clientY, true);
    };
    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerdown", move);
    hit.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); hideTip(); });
    hit.addEventListener("click", event => {
      const rect = svg.getBoundingClientRect();
      const i = Math.round(((event.clientX - rect.left - m.left) / iw) * (n - 1));
      if (i > 0 && games[i - 1] && event.pointerType !== "touch") openGameDialog(games[i - 1].game.id);
    });
  });
}

function renderSparkline(host, p, color) {
  if (!host) return;
  if (!p?.rated) {
    host.innerHTML = "";
    return;
  }
  const values = [RATING_SETTINGS.start, ...p.timeline.map(t => t.after)];
  const w = 240;
  const h = 44;
  const lo = Math.min(...values, RATING_SETTINGS.start) - 6;
  const hi = Math.max(...values, RATING_SETTINGS.start) + 6;
  const x = i => (values.length <= 1 ? w / 2 : (i / (values.length - 1)) * w);
  const y = v => h - ((v - lo) / (hi - lo)) * h;
  const d = values.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  host.innerHTML = `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" class="spark" aria-hidden="true" style="--c:${color}"><line x1="0" x2="${w}" y1="${y(RATING_SETTINGS.start).toFixed(1)}" y2="${y(RATING_SETTINGS.start).toFixed(1)}" class="spark-base"/><path d="${d}" class="spark-line" vector-effect="non-scaling-stroke"/><circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values.at(-1)).toFixed(1)}" r="3" class="spark-dot"/></svg>`;
}

function niceTicks(lo, hi, count) {
  const span = hi - lo;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map(f => f * mag).find(s => s >= step0) || mag * 10;
  const ticks = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(Math.round(t * 100) / 100);
  return ticks;
}

/* ---------------------------------------------------------------- sigils */

function sigilSvg(name, size = 40) {
  const key = nameKey(name);
  if (key === nameKey(LEGENDS.day)) return sunSigil(size);
  if (key === nameKey(LEGENDS.night)) return moonSigil(size);
  const hash = hashString(key);
  const hue = hash % 360;
  const points = 5 + (hash >> 3) % 4;
  const inner = 0.42 + ((hash >> 6) % 5) * 0.06;
  const rotation = (hash >> 9) % 360;
  const ring = (hash >> 12) % 3;
  const star = [];
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 ? 13 * inner : 13;
    const a = (Math.PI * i) / points + (rotation * Math.PI) / 180;
    star.push(`${(20 + r * Math.sin(a)).toFixed(2)},${(20 - r * Math.cos(a)).toFixed(2)}`);
  }
  const stroke = `hsl(${hue} 55% 68%)`;
  const fill = `hsl(${hue} 40% 22%)`;
  return `<svg class="sigil" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="19" fill="${fill}" stroke="${stroke}" stroke-width="1.2"/>
    ${ring === 0 ? `<circle cx="20" cy="20" r="16" fill="none" stroke="${stroke}" stroke-width=".6" stroke-dasharray="1 2"/>` : ring === 1 ? `<circle cx="20" cy="20" r="16" fill="none" stroke="${stroke}" stroke-opacity=".5" stroke-width=".6"/>` : ""}
    <polygon points="${star.join(" ")}" fill="${stroke}" fill-opacity=".18" stroke="${stroke}" stroke-width=".7" stroke-linejoin="round"/>
    <text x="20" y="25.5" text-anchor="middle" font-size="15" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" fill="#f4ecdb">${escapeHtml(String(name).trim().charAt(0).toUpperCase())}</text>
  </svg>`;
}

function sunSigil(size) {
  const rays = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const r0 = 11.5;
    const r1 = i % 2 ? 15 : 17;
    return `<line x1="${(20 + r0 * Math.cos(a)).toFixed(2)}" y1="${(20 + r0 * Math.sin(a)).toFixed(2)}" x2="${(20 + r1 * Math.cos(a)).toFixed(2)}" y2="${(20 + r1 * Math.sin(a)).toFixed(2)}"/>`;
  }).join("");
  return `<svg class="sigil sigil-sun" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <circle cx="20" cy="20" r="19" fill="#3a2a10" stroke="#e8b860" stroke-width="1.2"/>
    <g stroke="#e8b860" stroke-width="1.4" stroke-linecap="round">${rays}</g>
    <circle cx="20" cy="20" r="9" fill="#e8b860"/>
    <text x="20" y="24" text-anchor="middle" font-size="11" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" fill="#2a1d08">R</text>
  </svg>`;
}

function moonSigil(size) {
  const id = `m${Math.random().toString(36).slice(2, 8)}`;
  return `<svg class="sigil sigil-moon" width="${size}" height="${size}" viewBox="0 0 40 40" aria-hidden="true">
    <defs><mask id="${id}"><rect width="40" height="40" fill="#fff"/><circle cx="25" cy="15.5" r="10" fill="#000"/></mask></defs>
    <circle cx="20" cy="20" r="19" fill="#211a3d" stroke="#b8a6ff" stroke-width="1.2"/>
    <circle cx="8" cy="10" r=".8" fill="#ddd4ff"/><circle cx="31" cy="29" r=".9" fill="#ddd4ff"/><circle cx="29" cy="8" r=".6" fill="#ddd4ff"/>
    <circle cx="19" cy="21" r="11" fill="#ddd4ff" mask="url(#${id})"/>
    <text x="15.5" y="26" text-anchor="middle" font-size="10" font-family="Cormorant Garamond, Georgia, serif" font-weight="700" fill="#211a3d">N</text>
  </svg>`;
}

function legendClass(name) {
  if (nameKey(name) === nameKey(LEGENDS.day)) return "is-day";
  if (nameKey(name) === nameKey(LEGENDS.night)) return "is-night";
  return "";
}

function legendColor(name) {
  if (nameKey(name) === nameKey(LEGENDS.day)) return "var(--gold)";
  if (nameKey(name) === nameKey(LEGENDS.night)) return "var(--moon)";
  return `hsl(${hashString(nameKey(name)) % 360} 55% 68%)`;
}

function cssColor(color) {
  if (color === "var(--gold)") return "#e8b860";
  if (color === "var(--moon)") return "#b8a6ff";
  return color;
}

/* ---------------------------------------------------------------- ambience */

function drawSky() {
  const svg = els.skyLayer;
  const random = seeded(27);
  const stars = Array.from({ length: 110 }, () => {
    const x = (random() * 100).toFixed(2);
    const y = (random() * 100).toFixed(2);
    const r = (random() * 1.1 + 0.25).toFixed(2);
    const delay = (random() * 6).toFixed(2);
    const duration = (3 + random() * 5).toFixed(2);
    return `<circle cx="${x}%" cy="${y}%" r="${r}" style="animation-delay:${delay}s;animation-duration:${duration}s"/>`;
  }).join("");
  svg.innerHTML = stars;
}

function startClock() {
  const ticks = Array.from({ length: 12 }, (_, i) => {
    const a = (i * Math.PI) / 6;
    const r0 = i % 3 === 0 ? 25 : 28;
    return `<line x1="${200 + r0 * Math.sin(a)}" y1="${268 - r0 * Math.cos(a)}" x2="${200 + 31 * Math.sin(a)}" y2="${268 - 31 * Math.cos(a)}"/>`;
  }).join("");
  els.clockTicks.innerHTML = ticks;
  const tick = () => {
    const now = new Date();
    const seconds = now.getSeconds();
    const minutes = now.getMinutes() + seconds / 60;
    const hours = (now.getHours() % 12) + minutes / 60;
    els.clockHour.setAttribute("transform", `rotate(${hours * 30} 200 268)`);
    els.clockMinute.setAttribute("transform", `rotate(${minutes * 6} 200 268)`);
    els.clockSecond.setAttribute("transform", `rotate(${seconds * 6} 200 268)`);
  };
  tick();
  setInterval(tick, 1000);
}

function runCountUps(scope) {
  if (!scope) return;
  scope.querySelectorAll("[data-count]:not([data-counted])").forEach(node => {
    node.dataset.counted = "1";
    const target = Number(node.dataset.count);
    if (!Number.isFinite(target) || reduceMotion || target === 0) {
      node.textContent = fmtInt(target);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      const start = performance.now();
      const duration = 1100 + Math.min(900, Math.log10(Math.abs(target) + 1) * 250);
      const step = now => {
        const t = Math.min(1, (now - start) / duration);
        const eased = 1 - (1 - t) ** 4;
        node.textContent = fmtInt(target * eased);
        if (t < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    }, { threshold: 0.3 });
    observer.observe(node);
  });
}

function bindTips(scope) {
  scope.querySelectorAll("[data-tip]").forEach(node => {
    if (node.dataset.tipBound) return;
    node.dataset.tipBound = "1";
    const show = event => {
      const lines = node.dataset.tip.split("\n");
      const point = event.clientX !== undefined && event.type !== "focus"
        ? [event.clientX, event.clientY]
        : (() => { const r = node.getBoundingClientRect(); return [r.left + r.width / 2, r.top]; })();
      showTip(`<strong>${escapeHtml(lines[0])}</strong>${lines.slice(1).map(line => `<span class="tip-sub">${escapeHtml(line)}</span>`).join("")}`, point[0], point[1]);
    };
    node.addEventListener("pointerenter", show);
    node.addEventListener("pointermove", show);
    node.addEventListener("focus", show);
    node.addEventListener("pointerleave", hideTip);
    node.addEventListener("blur", hideTip);
  });
}

function showTip(html, clientX, clientY, wide = false) {
  const tip = els.tooltip;
  tip.innerHTML = html;
  tip.hidden = false;
  tip.classList.toggle("is-wide", wide);
  const rect = tip.getBoundingClientRect();
  let left = clientX + 14;
  let top = clientY - rect.height - 12;
  if (left + rect.width > window.innerWidth - 8) left = clientX - rect.width - 14;
  if (top < 8) top = clientY + 18;
  tip.style.transform = `translate(${Math.max(8, left)}px, ${top}px)`;
}

function hideTip() {
  els.tooltip.hidden = true;
}

/* ---------------------------------------------------------------- entry (storyteller) */

function renderDatalists() {
  els.playerOptions.innerHTML = state.players.map(name => `<option value="${escapeHtml(name)}"></option>`).join("");
  els.roleOptions.innerHTML = collectRoles(getAllGames()).map(role => `<option value="${escapeHtml(role)}"></option>`).join("");
  const scripts = [...new Set(getAllGames().map(game => game.script).filter(Boolean))].sort();
  els.scriptOptions.innerHTML = scripts.map(script => `<option value="${escapeHtml(script)}"></option>`).join("");
}

function collectRoles(games) {
  const roles = new Set([...GOOD_ROLES, ...EVIL_ROLES, ...TRAVELER_ROLES, ...state.draftRoles]);
  games.forEach(game => Object.values(game.roles).forEach(role => { if (role) roles.add(role); }));
  return [...roles].sort((a, b) => a.localeCompare(b));
}

function requestEntryUnlock(gameId = "") {
  state.pendingEditGameId = gameId;
  els.passcodeForm.reset();
  els.passcodeMessage.textContent = "";
  els.passcodeMessage.classList.remove("error");
  if (els.gameDialog.open) els.gameDialog.close();
  els.passcodeDialog.showModal();
  window.setTimeout(() => els.passcodeInput.focus(), 0);
}

async function submitPasscode() {
  const passcode = els.passcodeInput.value;
  const unlocked = state.databaseAvailable ? await verifyServerPasscode(passcode) : passcode === DEFAULT_ENTRY_PASSCODE;
  if (unlocked) {
    state.activePasscode = passcode;
    els.passcodeDialog.close();
    if (state.pendingEditGameId) {
      const gameId = state.pendingEditGameId;
      state.pendingEditGameId = "";
      openEditGame(gameId);
    } else {
      openEntryDialog();
    }
    return;
  }
  els.passcodeMessage.textContent = "Incorrect passcode.";
  els.passcodeMessage.classList.add("error");
  els.passcodeInput.select();
}

async function verifyServerPasscode(passcode) {
  try {
    const response = await fetch("/api/unlock", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

function openEntryDialog() {
  state.editingGameId = "";
  els.entryForm.reset();
  els.entryEyebrow.textContent = "New result";
  els.entryTitle.textContent = "Enter game";
  els.saveEntry.textContent = "Save game";
  els.entryDate.valueAsDate = new Date();
  els.entryScript.value = "Trouble Brewing";
  els.newPlayerName.value = "";
  els.newRoleName.value = "";
  els.participantRows.innerHTML = "";
  for (let i = 0; i < 8; i += 1) addParticipantRow();
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
  renderEntryPreview();
  els.entryDialog.showModal();
}

function openEditGame(gameId) {
  const game = getAllGames().find(item => item.id === gameId);
  if (!game || !state.databaseAvailable) return;
  state.editingGameId = game.id;
  els.entryForm.reset();
  els.entryEyebrow.textContent = "Existing result";
  els.entryTitle.textContent = "Edit game";
  els.saveEntry.textContent = "Update game";
  els.entryDate.value = sheetDateToHtmlDate(game.date);
  els.entryOutcome.value = game.outcome === "Evil" ? "Evil" : "Good";
  els.entryFinalDay.value = finalDayValue(game.finalDay);
  els.entryStoryteller.value = game.storyteller || "";
  els.entryFormat.value = game.format || "In-Person";
  els.entryScript.value = game.script || "";
  els.newPlayerName.value = "";
  els.newRoleName.value = "";
  els.participantRows.innerHTML = "";
  getGameParticipants(game).forEach(participant => {
    addParticipantRow({
      name: participant.name,
      role: participant.role,
      alignment: participant.alignment || "auto",
      result: participant.result || "Loss",
    });
  });
  if (!els.participantRows.children.length) addParticipantRow();
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
  if (els.gameDialog.open) els.gameDialog.close();
  renderEntryPreview();
  els.entryDialog.showModal();
}

function addNewPlayerToEntry() {
  const name = clean(els.newPlayerName.value);
  if (!name) {
    els.entryMessage.textContent = "Enter a player name first.";
    els.entryMessage.classList.add("error");
    els.newPlayerName.focus();
    return;
  }
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
  state.draftPlayers.add(name);
  if (!state.players.includes(name)) state.players.push(name);
  renderDatalists();
  const row = addParticipantRow({ name });
  row.querySelector('[data-field="role"]').focus();
  els.newPlayerName.value = "";
}

function addNewRoleToEntry() {
  const role = clean(els.newRoleName.value);
  if (!role) {
    els.entryMessage.textContent = "Enter a role name first.";
    els.entryMessage.classList.add("error");
    els.newRoleName.focus();
    return;
  }
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
  state.draftRoles.add(role);
  renderDatalists();
  const activeRoleInput = document.activeElement?.matches?.('[data-field="role"]') ? document.activeElement : null;
  const target = activeRoleInput
    || [...els.participantRows.querySelectorAll('[data-field="role"]')].find(input => !clean(input.value))
    || addParticipantRow().querySelector('[data-field="role"]');
  target.value = role;
  updateParticipantAlignmentFromRole(target.closest(".participant-row"));
  updateParticipantResult(target.closest(".participant-row"), { force: true });
  target.focus();
  els.newRoleName.value = "";
  renderEntryPreview();
}

function addParticipantRow(data = {}) {
  const node = els.participantTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.alignmentManual = data.alignment && data.alignment !== "auto" ? "true" : "false";
  node.dataset.resultManual = data.result ? "true" : "false";
  node.querySelector('[data-field="name"]').value = data.name || "";
  node.querySelector('[data-field="role"]').value = data.role || "";
  node.querySelector('[data-field="alignment"]').value = data.alignment || "auto";
  node.querySelector('[data-field="result"]').value = data.result || "Loss";
  node.querySelector(".remove-participant").addEventListener("click", () => { node.remove(); renderEntryPreview(); });
  node.querySelector('[data-field="role"]').addEventListener("change", () => {
    updateParticipantAlignmentFromRole(node);
    updateParticipantResult(node);
  });
  node.querySelector('[data-field="alignment"]').addEventListener("change", () => {
    node.dataset.alignmentManual = node.querySelector('[data-field="alignment"]').value === "auto" ? "false" : "true";
    updateParticipantResult(node);
  });
  node.querySelector('[data-field="result"]').addEventListener("change", () => { node.dataset.resultManual = "true"; });
  els.participantRows.append(node);
  updateParticipantAlignmentFromRole(node);
  updateParticipantResult(node, { force: !data.result });
  return node;
}

function updateParticipantAlignmentFromRole(row) {
  const role = clean(row.querySelector('[data-field="role"]').value);
  const alignment = row.querySelector('[data-field="alignment"]');
  if (row.dataset.alignmentManual === "true") return;
  alignment.value = TRAVELER_ROLES.has(role) ? "Good" : roleAlignment(role) || "auto";
}

function updateParticipantResult(row, options = {}) {
  if (!options.force && row.dataset.resultManual === "true") return;
  const result = row.querySelector('[data-field="result"]');
  result.value = resolveEntryAlignment(row) === els.entryOutcome.value ? "Win" : "Loss";
}

function updateAllParticipantResults() {
  els.participantRows.querySelectorAll(".participant-row").forEach(row => updateParticipantResult(row));
  renderEntryPreview();
}

function resolveEntryAlignment(row) {
  const role = clean(row.querySelector('[data-field="role"]').value);
  const alignmentValue = row.querySelector('[data-field="alignment"]').value;
  if (alignmentValue !== "auto") return alignmentValue;
  return roleAlignment(role) || "Good";
}

function readParticipants() {
  return [...els.participantRows.querySelectorAll(".participant-row")]
    .map(row => ({
      name: clean(row.querySelector('[data-field="name"]').value),
      role: clean(row.querySelector('[data-field="role"]').value),
      alignmentValue: row.querySelector('[data-field="alignment"]').value,
      resultValue: row.querySelector('[data-field="result"]').value,
      resolved: resolveEntryAlignment(row),
    }))
    .filter(item => item.name && item.role);
}

function renderEntryPreview() {
  if (!els.entryPreview || !state.model) return;
  const participants = readParticipants().filter(item => !TRAVELER_ROLES.has(item.role));
  const outcome = els.entryOutcome.value;
  // Team membership follows the Win/Loss result, exactly as the rating engine reads it.
  const winners = participants.filter(item => item.resultValue === "Win").map(item => item.name);
  const losers = participants.filter(item => item.resultValue !== "Win").map(item => item.name);
  const good = outcome === "Good" ? winners : losers;
  const evil = outcome === "Good" ? losers : winners;
  if (!good.length || !evil.length) {
    els.entryPreview.innerHTML = `<p class="section-copy">Add players to both teams to preview Elo.</p>`;
    return;
  }
  const preview = previewMatchup(state.model, good, evil);
  const result = outcome === "Good" ? preview.ifGood : preview.ifEvil;
  els.entryPreview.innerHTML = `<p class="eyebrow">Elo preview</p><p class="section-copy">Forecast: Good <strong class="good-text">${fmtPct(preview.pGood)}</strong>. Change each: Good <strong class="${result.goodChange >= 0 ? "up" : "down"}">${fmtSigned(result.goodChange)}</strong>, Evil <strong class="${result.evilChange >= 0 ? "up" : "down"}">${fmtSigned(result.evilChange)}</strong>${result.cap < 1 ? ` (capped ×${result.cap.toFixed(2)})` : ""}.</p>`;
}

async function saveEntry() {
  const participants = readParticipants();
  if (!els.entryDate.value || !participants.length) {
    els.entryMessage.textContent = "Date and at least one player are required.";
    els.entryMessage.classList.add("error");
    return;
  }
  const duplicateNames = participants.map(item => nameKey(item.name)).filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length) {
    els.entryMessage.textContent = `Duplicate player: ${participants.find(item => nameKey(item.name) === duplicateNames[0]).name}.`;
    els.entryMessage.classList.add("error");
    return;
  }
  els.entryMessage.classList.remove("error");

  const outcome = els.entryOutcome.value;
  const roles = {};
  const alignmentOverrides = {};
  const winNames = [];
  const lossNames = [];
  participants.forEach(item => {
    roles[item.name] = item.role;
    let alignment = item.alignmentValue === "auto" ? roleAlignment(item.role) : item.alignmentValue;
    if (!alignment) alignment = "Good";
    alignmentOverrides[item.name] = alignment;
    const isTraveler = TRAVELER_ROLES.has(item.role);
    const result = item.resultValue || (alignment === outcome ? "Win" : "Loss");
    if (!isTraveler && result === "Win") winNames.push(item.name);
    if (!isTraveler && result === "Loss") lossNames.push(item.name);
  });

  const editingGame = state.editingGameId ? getAllGames().find(item => item.id === state.editingGameId) : null;
  const game = {
    id: state.editingGameId || `draft-${Date.now()}`,
    source: editingGame?.source || "draft",
    date: htmlDateToSheetDate(els.entryDate.value),
    outcome,
    finalDay: els.entryFinalDay.value,
    storyteller: clean(els.entryStoryteller.value),
    playerCount: participants.filter(item => !TRAVELER_ROLES.has(item.role)).length,
    format: els.entryFormat.value,
    script: clean(els.entryScript.value),
    winNames,
    lossNames,
    roles,
    alignmentOverrides,
  };

  if (!state.databaseAvailable) {
    els.entryMessage.textContent = "Start node server.mjs to save to the database.";
    els.entryMessage.classList.add("error");
    return;
  }
  try {
    const isEditing = Boolean(state.editingGameId);
    const response = await fetch(isEditing ? `/api/games/${encodeURIComponent(state.editingGameId)}` : "/api/games", {
      method: isEditing ? "PUT" : "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode: state.activePasscode, game }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      els.entryMessage.textContent = payload.error || "Could not save game.";
      els.entryMessage.classList.add("error");
      return;
    }
    if (isEditing) state.games = state.games.map(item => (item.id === payload.game.id ? payload.game : item));
    else state.games.push(payload.game);
  } catch {
    els.entryMessage.textContent = "Database server is unavailable.";
    els.entryMessage.classList.add("error");
    return;
  }

  participants.forEach(item => {
    state.draftPlayers.add(item.name);
    state.draftRoles.add(item.role);
  });
  state.editingGameId = "";
  els.entryDialog.close();
  rebuild();
  location.hash = "#games";
  setView("games");
}

function clearLocalEntries() {
  els.participantRows.innerHTML = "";
  for (let i = 0; i < 8; i += 1) addParticipantRow();
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
  renderEntryPreview();
}

function openDeleteDialog(gameId) {
  const game = getAllGames().find(item => item.id === gameId);
  if (!game) return;
  state.pendingDeleteGameId = game.id;
  els.deleteForm.reset();
  els.deleteMessage.textContent = "";
  els.deleteMessage.classList.remove("error");
  els.deleteGameName.textContent = `${shortDate(game.date)} ${game.script || "Game"}`;
  els.deleteGameSummary.textContent = `${game.outcome} victory, ${game.playerCount || countParticipants(game)} players, storyteller ${game.storyteller || "unknown"}.`;
  if (els.gameDialog.open) els.gameDialog.close();
  els.deleteDialog.showModal();
  window.setTimeout(() => els.deletePasscodeInput.focus(), 0);
}

async function deleteSelectedGame() {
  const gameId = state.pendingDeleteGameId;
  const passcode = els.deletePasscodeInput.value;
  if (!gameId || !passcode) {
    els.deleteMessage.textContent = "Passcode required.";
    els.deleteMessage.classList.add("error");
    return;
  }
  try {
    const response = await fetch(`/api/games/${encodeURIComponent(gameId)}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ passcode }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      els.deleteMessage.textContent = payload.error || "Could not delete game.";
      els.deleteMessage.classList.add("error");
      els.deletePasscodeInput.select();
      return;
    }
  } catch {
    els.deleteMessage.textContent = "Database server is unavailable.";
    els.deleteMessage.classList.add("error");
    return;
  }
  state.games = state.games.filter(game => game.id !== gameId);
  state.pendingDeleteGameId = "";
  els.deleteDialog.close();
  rebuild();
  location.hash = "#games";
  setView("games");
}

/* ---------------------------------------------------------------- CSV export */

function downloadRecordCsv() {
  const games = getAllGames();
  const players = state.players;
  const headers = [...BASE_COLUMNS, ...players];
  const meta = Array.from({ length: headers.length }, () => "");
  meta[0] = String(games.length);
  meta[2] = "Blood on the Clocktower: Psi Press Master Sheet";
  const rows = [meta, headers, ...games.map(game => [
    sheetDateToCsvDate(game.date),
    game.outcome,
    game.finalDay === "1" ? "TRUE" : game.finalDay === "0" ? "FALSE" : game.finalDay,
    game.storyteller,
    game.playerCount || countParticipants(game),
    game.format,
    game.script,
    game.winNames.join(", "),
    game.lossNames.join(", "),
    ...players.map(name => {
      const key = Object.keys(game.roles).find(item => nameKey(item) === nameKey(name));
      return key ? game.roles[key] : "n/a";
    }),
  ])];
  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "botc-games-sheet-export.csv";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/* ---------------------------------------------------------------- utilities */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];
    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      i += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

function clean(value) {
  return String(value ?? "").trim();
}

function csvDateToDisplay(value) {
  const date = clean(value);
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(date);
  return match ? `${match[1]}/${match[2]}/${match[3].slice(-2)}` : date;
}

function sheetDateToCsvDate(value) {
  const parts = clean(value).split("/").map(Number);
  if (parts.length !== 3) return value;
  const [month, day, year] = parts;
  return `${month}/${day}/${year < 100 ? 2000 + year : year}`;
}

function finalDayValue(value) {
  const finalDay = clean(value).toLowerCase();
  return finalDay === "true" ? "1" : finalDay === "false" ? "0" : finalDay;
}

function numberOrZero(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitNames(value) {
  return clean(value).split(",").map(name => name.trim()).filter(Boolean);
}

function countParticipants(game) {
  return Object.values(game.roles).filter(role => role && !TRAVELER_ROLES.has(role)).length;
}

function compareDates(a, b) {
  return sheetDateValue(a) - sheetDateValue(b);
}

function parseSheetDate(value) {
  const parts = clean(value).split("/").map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
  const [month, day, year] = parts;
  return new Date(year < 100 ? 2000 + year : year, month - 1, day);
}

function sheetDateValue(value) {
  return parseSheetDate(value)?.getTime() ?? 0;
}

function fullYear(value) {
  return parseSheetDate(value)?.getFullYear() ?? "";
}

function shortDate(value) {
  const date = parseSheetDate(value);
  return date ? date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : clean(value);
}

function longDate(value) {
  const date = parseSheetDate(value);
  return date ? date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : clean(value);
}

function monthYear(value) {
  const date = parseSheetDate(value);
  return date ? date.toLocaleDateString("en-US", { month: "short", year: "2-digit" }).replace(" ", " ’") : clean(value);
}

function htmlDateToSheetDate(value) {
  const [year, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}/${year.slice(-2)}`;
}

function sheetDateToHtmlDate(value) {
  const date = parseSheetDate(value);
  if (!date) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function ratio(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function fmtPct(value, digits = 0) {
  return value === null || value === undefined || Number.isNaN(value) ? "—" : `${(value * 100).toFixed(digits)}%`;
}

function fmtInt(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  return `${rounded < 0 ? MINUS : ""}${Math.abs(rounded).toLocaleString("en-US")}`;
}

function fmtSigned(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return "—";
  const rounded = Math.round(value);
  if (rounded === 0) return "±0";
  return `${rounded > 0 ? "+" : MINUS}${Math.abs(rounded).toLocaleString("en-US")}`;
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function numberWords(n) {
  const ones = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
  const tens = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
  if (n < 20) return ones[n];
  if (n < 100) return `${tens[Math.floor(n / 10)]}${n % 10 ? `-${ones[n % 10]}` : ""}`;
  return String(n);
}

function countBy(values) {
  const map = new Map();
  values.forEach(value => map.set(value, (map.get(value) || 0) + 1));
  return map;
}

function hashString(value) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seeded(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
