const RECORD_CSV = "Blood on the Clocktower - Master Sheet - Record.csv";
const DEFAULT_ENTRY_PASSCODE = "psip";

const BASE_COLUMNS = [
  "",
  "Outcome",
  "Final Day",
  "Storyteller",
  "Player Count",
  "Format",
  "Script",
  "Win",
  "Loss",
];

const TRAVELER_ROLES = new Set([
  "Apprentice",
  "Barista",
  "Beggar",
  "Bone Collector",
  "Bureaucrat",
  "Butcher",
  "Deviant",
  "Gunslinger",
  "Harlot",
  "Judge",
  "Matron",
  "Scapegoat",
  "Thief",
  "Voudon",
]);

const GOOD_ROLES = new Set([
  "Artist",
  "Barber",
  "Butler",
  "Chambermaid",
  "Chef",
  "Clockmaker",
  "Courtier",
  "Dreamer",
  "Drunk",
  "Empath",
  "Exorcist",
  "Flowergirl",
  "Fool",
  "Fortune Teller",
  "Gambler",
  "Goon",
  "Gossip",
  "Grandmother",
  "Innkeeper",
  "Investigator",
  "Juggler",
  "Klutz",
  "Librarian",
  "Lunatic",
  "Mathematician",
  "Mayor",
  "Monk",
  "Moonchild",
  "Mutant",
  "Oracle",
  "Philosopher",
  "Professor",
  "Ravenkeeper",
  "Recluse",
  "Sage",
  "Sailor",
  "Saint",
  "Savant",
  "Seamstress",
  "Slayer",
  "Snake Charmer",
  "Soldier",
  "Sweetheart",
  "Tinker",
  "Town Crier",
  "Undertaker",
  "Virgin",
  "Washerwoman",
]);

const EVIL_ROLES = new Set([
  "Assassin",
  "Baron",
  "Cerenovus",
  "Devil's Advocate",
  "Evil Twin",
  "Fang Gu",
  "Godfather",
  "Imp",
  "Mastermind",
  "No Dashii",
  "Pit Hag",
  "Poisoner",
  "Pukka",
  "Scarlet Woman",
  "Shabaloth",
  "Spy",
  "Vigormortis",
  "Vortox",
  "Witch",
  "Zombuul",
]);

const SEEDED_TRAVELER_ALIGNMENT = {
  "1/25/26|Kate|Barista": "Good",
  "1/25/26|Will|Bone Collector": "Evil",
  "4/4/26|Filippos|Deviant": "Good",
  "4/4/26|Morgan|Barista": "Evil",
};

const state = {
  headers: [],
  players: [],
  games: [],
  localGames: [],
  draftPlayers: new Set(),
  draftRoles: new Set(),
  databaseAvailable: false,
  activePasscode: "",
  pendingDeleteGameId: "",
  stats: [],
  selectedPlayer: "",
  issues: [],
};

const els = {};

document.addEventListener("DOMContentLoaded", init);

async function init() {
  cacheElements();
  bindEvents();

  try {
    const databaseState = await loadDatabaseState();
    if (databaseState) {
      state.databaseAvailable = true;
      state.headers = databaseState.headers;
      state.players = state.headers.slice(9).filter(Boolean);
      state.games = databaseState.games;
      state.localGames = [];
    } else {
      const response = await fetch(RECORD_CSV);
      if (!response.ok) throw new Error(`Could not load ${RECORD_CSV}`);
      const csv = await response.text();
      const rows = parseCsv(csv);
      state.headers = rows[1];
      state.players = state.headers.slice(9).filter(Boolean);
      state.games = rows.slice(2).map(rowToGame).filter(Boolean);
      state.localGames = [];
    }
    rebuild();
    applyRuntimeMode();
  } catch (error) {
    document.body.innerHTML = `<main class="empty-state">Unable to load game data. Run <code>node server.mjs</code> from this folder, then open the site again.</main>`;
    console.error(error);
  }
}

function applyRuntimeMode() {
  document.body.classList.toggle("is-readonly", !state.databaseAvailable);
  if (!state.databaseAvailable) {
    els.eggButton.hidden = true;
  }
}

async function loadDatabaseState() {
  try {
    const response = await fetch("/api/state", { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

function cacheElements() {
  Object.assign(els, {
    metricGames: document.querySelector("#metricGames"),
    metricPlayers: document.querySelector("#metricPlayers"),
    metricGoodWins: document.querySelector("#metricGoodWins"),
    metricLatest: document.querySelector("#metricLatest"),
    playerSearch: document.querySelector("#playerSearch"),
    playerSort: document.querySelector("#playerSort"),
    playerTableBody: document.querySelector("#playerTableBody"),
    playerDialog: document.querySelector("#playerDialog"),
    playerDialogName: document.querySelector("#playerDialogName"),
    playerDialogContent: document.querySelector("#playerDialogContent"),
    playerDialogClose: document.querySelector("#playerDialogClose"),
    gameDialog: document.querySelector("#gameDialog"),
    gameDialogName: document.querySelector("#gameDialogName"),
    gameDialogContent: document.querySelector("#gameDialogContent"),
    gameDialogClose: document.querySelector("#gameDialogClose"),
    scriptFilter: document.querySelector("#scriptFilter"),
    gameTableBody: document.querySelector("#gameTableBody"),
    issuesPanel: document.querySelector("#issuesPanel"),
    deleteDialog: document.querySelector("#deleteDialog"),
    deleteForm: document.querySelector("#deleteForm"),
    deleteGameName: document.querySelector("#deleteGameName"),
    deleteGameSummary: document.querySelector("#deleteGameSummary"),
    deletePasscodeInput: document.querySelector("#deletePasscodeInput"),
    deleteConfirm: document.querySelector("#deleteConfirm"),
    deleteMessage: document.querySelector("#deleteMessage"),
    downloadRecord: document.querySelector("#downloadRecord"),
    downloadStats: document.querySelector("#downloadStats"),
    eggButton: document.querySelector("#eggButton"),
    passcodeDialog: document.querySelector("#passcodeDialog"),
    passcodeForm: document.querySelector("#passcodeForm"),
    passcodeInput: document.querySelector("#passcodeInput"),
    passcodeSubmit: document.querySelector("#passcodeSubmit"),
    passcodeMessage: document.querySelector("#passcodeMessage"),
    entryDialog: document.querySelector("#entryDialog"),
    entryForm: document.querySelector("#entryForm"),
    entryDate: document.querySelector("#entryDate"),
    entryOutcome: document.querySelector("#entryOutcome"),
    entryFinalDay: document.querySelector("#entryFinalDay"),
    entryStoryteller: document.querySelector("#entryStoryteller"),
    entryFormat: document.querySelector("#entryFormat"),
    entryScript: document.querySelector("#entryScript"),
    participantRows: document.querySelector("#participantRows"),
    participantTemplate: document.querySelector("#participantTemplate"),
    newPlayerName: document.querySelector("#newPlayerName"),
    addNewPlayer: document.querySelector("#addNewPlayer"),
    newRoleName: document.querySelector("#newRoleName"),
    addNewRole: document.querySelector("#addNewRole"),
    addParticipant: document.querySelector("#addParticipant"),
    saveEntry: document.querySelector("#saveEntry"),
    resetLocalGames: document.querySelector("#resetLocalGames"),
    entryMessage: document.querySelector("#entryMessage"),
    playerOptions: document.querySelector("#playerOptions"),
    roleOptions: document.querySelector("#roleOptions"),
    scriptOptions: document.querySelector("#scriptOptions"),
  });
}

function bindEvents() {
  document.querySelectorAll("[data-view-button]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.viewButton));
  });
  document.querySelectorAll("[data-view-link]").forEach(button => {
    button.addEventListener("click", () => setView(button.dataset.viewLink));
  });
  els.playerSearch.addEventListener("input", renderPlayerTable);
  els.playerSort.addEventListener("change", renderPlayerTable);
  els.playerDialogClose.addEventListener("click", () => els.playerDialog.close());
  els.gameDialogClose.addEventListener("click", () => els.gameDialog.close());
  els.scriptFilter.addEventListener("change", renderGames);
  els.deleteConfirm.addEventListener("click", deleteSelectedGame);
  els.deletePasscodeInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      deleteSelectedGame();
    }
  });
  els.downloadRecord.addEventListener("click", downloadRecordCsv);
  els.downloadStats.addEventListener("click", downloadStatsCsv);
  els.eggButton.addEventListener("click", requestEntryUnlock);
  els.passcodeSubmit.addEventListener("click", submitPasscode);
  els.passcodeInput.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      submitPasscode();
    }
  });
  els.entryForm.addEventListener("keydown", preventEntryFormEnterSubmit);
  els.addNewPlayer.addEventListener("click", addNewPlayerToEntry);
  els.newPlayerName.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addNewPlayerToEntry();
    }
  });
  els.addNewRole.addEventListener("click", addNewRoleToEntry);
  els.newRoleName.addEventListener("keydown", event => {
    if (event.key === "Enter") {
      event.preventDefault();
      addNewRoleToEntry();
    }
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

function setView(view) {
  document.querySelectorAll("[data-view-button]").forEach(button => {
    button.classList.toggle("is-active", button.dataset.viewButton === view);
  });
  document.querySelectorAll("[data-view]").forEach(panel => {
    panel.classList.toggle("is-active", panel.dataset.view === view);
  });
}

function rebuild() {
  const allGames = getAllGames();
  state.players = collectPlayers(allGames);
  state.stats = computeStats(allGames, state.players);
  state.issues = findIssues(allGames, state.players);
  state.selectedPlayer = state.selectedPlayer || firstActivePlayer();
  renderAll();
}

function renderAll() {
  renderDatalists();
  renderSummary();
  renderPlayerTable();
  renderScriptFilter();
  renderGames();
  renderIssues();
}

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

function rowToGame(row, index) {
  const date = clean(row[0]);
  const outcome = clean(row[1]);
  if (!date || !outcome) return null;

  const roles = {};
  state.headers.slice(9).forEach((player, offset) => {
    const role = clean(row[offset + 9]);
    if (role && role.toLowerCase() !== "n/a") roles[player] = role;
  });

  return {
    id: `csv-${index}`,
    source: "csv",
    date,
    outcome,
    finalDay: clean(row[2]),
    storyteller: clean(row[3]),
    playerCount: numberOrZero(row[4]),
    format: clean(row[5]),
    script: clean(row[6]),
    winNames: splitNames(row[7]),
    lossNames: splitNames(row[8]),
    roles,
    alignmentOverrides: {},
  };
}

function clean(value) {
  return String(value ?? "").trim();
}

function numberOrZero(value) {
  const parsed = Number.parseInt(clean(value), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function splitNames(value) {
  return clean(value)
    .split(",")
    .map(name => name.trim())
    .filter(Boolean);
}

function getAllGames() {
  return [...state.games, ...state.localGames].sort((a, b) => compareDates(a.date, b.date));
}

function collectPlayers(games) {
  const names = new Set([...state.headers.slice(9).filter(Boolean), ...state.draftPlayers]);
  games.forEach(game => {
    game.winNames.forEach(name => names.add(name));
    game.lossNames.forEach(name => names.add(name));
    Object.keys(game.roles).forEach(name => names.add(name));
  });
  return [...names].sort((a, b) => a.localeCompare(b));
}

function computeStats(games, players) {
  return players.map(player => {
    const stat = {
      player,
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
      roles: new Map(),
      history: [],
    };

    games.forEach(game => {
      const entry = getPlayerEntry(game, player);
      if (!entry.active) return;

      if (entry.isTraveler) {
        if (entry.alignment === "Good") stat.travelsGood += 1;
        if (entry.alignment === "Evil") stat.travelsEvil += 1;
        stat.history.push({ ...entry, game });
        return;
      }

      stat.games += 1;
      if (entry.result === "Win") stat.wins += 1;
      if (entry.result === "Loss") stat.losses += 1;

      if (entry.alignment === "Good") {
        stat.goodGames += 1;
        if (entry.teamResult === "Win") stat.goodWins += 1;
        if (entry.teamResult === "Loss") stat.goodLosses += 1;
      }
      if (entry.alignment === "Evil") {
        stat.evilGames += 1;
        if (entry.teamResult === "Win") stat.evilWins += 1;
        if (entry.teamResult === "Loss") stat.evilLosses += 1;
      }

      if (entry.role) stat.roles.set(entry.role, (stat.roles.get(entry.role) || 0) + 1);
      stat.history.push({ ...entry, game });
    });

    stat.success = percentValue(stat.wins, stat.games);
    stat.goodWinrate = percentValue(stat.goodWins, stat.goodGames);
    stat.evilWinrate = percentValue(stat.evilWins, stat.evilGames);
    stat.goodFrequency = percentValue(stat.goodGames, stat.games);
    stat.evilFrequency = percentValue(stat.evilGames, stat.games);
    return stat;
  });
}

function getPlayerEntry(game, player) {
  const role = clean(game.roles[player]);
  const listedWin = game.winNames.includes(player);
  const listedLoss = game.lossNames.includes(player);
  const isTraveler = TRAVELER_ROLES.has(role);
  const active = Boolean(role) || listedWin || listedLoss;
  const listedResult = listedWin ? "Win" : listedLoss ? "Loss" : "";
  const alignment = resolveAlignment(game, player, role, listedResult);
  const teamResult = alignment ? (alignment === game.outcome ? "Win" : "Loss") : listedResult;

  return {
    active,
    role,
    isTraveler,
    listedResult,
    result: listedResult || teamResult,
    teamResult,
    alignment,
  };
}

function resolveAlignment(game, player, role, result) {
  const override = game.alignmentOverrides?.[player];
  if (override === "Good" || override === "Evil") return override;

  const seeded = SEEDED_TRAVELER_ALIGNMENT[`${game.date}|${player}|${role}`];
  if (seeded) return seeded;

  if (GOOD_ROLES.has(role)) return "Good";
  if (EVIL_ROLES.has(role)) return "Evil";

  if (result === "Win") return game.outcome;
  if (result === "Loss") return oppositeOutcome(game.outcome);

  return "";
}

function oppositeOutcome(outcome) {
  return outcome === "Good" ? "Evil" : "Good";
}

function percentValue(numerator, denominator) {
  return denominator > 0 ? numerator / denominator : null;
}

function formatPercent(value, digits = 0) {
  return value === null ? "--" : `${(value * 100).toFixed(digits)}%`;
}

function renderSummary() {
  const games = getAllGames();
  const activePlayers = state.stats.filter(stat => stat.games + stat.travelsGood + stat.travelsEvil > 0).length;
  const goodWins = games.filter(game => game.outcome === "Good").length;
  const latest = [...games].sort((a, b) => compareDates(b.date, a.date))[0];

  els.metricGames.textContent = String(games.length);
  els.metricPlayers.textContent = String(activePlayers);
  els.metricGoodWins.textContent = `${goodWins}-${games.length - goodWins}`;
  els.metricLatest.textContent = latest ? latest.date : "--";
}

function renderPlayerTable() {
  const query = clean(els.playerSearch.value).toLowerCase();
  const sort = els.playerSort.value;
  const filtered = state.stats.filter(stat => {
    const roles = [...stat.roles.keys()].join(" ").toLowerCase();
    return !query || stat.player.toLowerCase().includes(query) || roles.includes(query);
  });

  filtered.sort((a, b) => {
    if (sort === "name") return a.player.localeCompare(b.player);
    if (sort === "success") return (b.success ?? -1) - (a.success ?? -1) || b.games - a.games;
    if (sort === "wins") return b.wins - a.wins || b.games - a.games;
    if (sort === "evilFrequency") return (b.evilFrequency ?? -1) - (a.evilFrequency ?? -1) || b.games - a.games;
    return b.games - a.games || a.player.localeCompare(b.player);
  });

  els.playerTableBody.innerHTML = filtered.map(stat => `
    <tr class="clickable-row" data-select-player="${escapeHtml(stat.player)}" tabindex="0">
      <td><span class="player-name-cell">${escapeHtml(stat.player)}</span></td>
      <td>${stat.games}</td>
      <td>${stat.wins}-${stat.losses}</td>
      <td><span class="ratio">${formatPercent(stat.success, 1)}</span></td>
      <td><span class="ratio good">${stat.goodWins}-${stat.goodLosses} (${formatPercent(stat.goodWinrate)})</span></td>
      <td><span class="ratio evil">${stat.evilWins}-${stat.evilLosses} (${formatPercent(stat.evilWinrate)})</span></td>
      <td>${stat.travelsGood + stat.travelsEvil}</td>
    </tr>
  `).join("") || `<tr><td colspan="7" class="empty-state">No matching players.</td></tr>`;

  els.playerTableBody.querySelectorAll("[data-select-player]").forEach(button => {
    button.addEventListener("click", () => openPlayerDialog(button.dataset.selectPlayer));
    button.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openPlayerDialog(button.dataset.selectPlayer);
      }
    });
  });
}

function openPlayerDialog(player) {
  const stat = state.stats.find(item => item.player === player);
  if (!stat) return;

  state.selectedPlayer = stat.player;
  els.playerDialogName.textContent = stat.player;
  els.playerDialogContent.innerHTML = renderPlayerDialogContent(stat);
  els.playerDialog.showModal();
}

function renderPlayerDialogContent(stat) {
  const spreadsheetStats = [
    ["Games Played", stat.games],
    ["# of Evil Travels", stat.travelsEvil],
    ["# of Good Travels", stat.travelsGood],
    ["# of Wins", stat.wins],
    ["# of Losses", stat.losses],
    ["Success %", formatPercent(stat.success, 1)],
    ["Evil Games", stat.evilGames],
    ["Evil Wins", stat.evilWins],
    ["Evil Losses", stat.evilLosses],
    ["Evil Winrate", formatPercent(stat.evilWinrate)],
    ["Evil Frequency", formatPercent(stat.evilFrequency)],
    ["Good Games", stat.goodGames],
    ["Good Wins", stat.goodWins],
    ["Good Losses", stat.goodLosses],
    ["Good Winrate", formatPercent(stat.goodWinrate)],
    ["Good Frequency", formatPercent(stat.goodFrequency)],
  ];
  const topRoles = [...stat.roles.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12);
  const recent = [...stat.history]
    .sort((a, b) => compareDates(b.game.date, a.game.date))
    .slice(0, 10);

  return `
    <section class="player-dialog-summary">
      <article><span>Record</span><strong>${stat.wins}-${stat.losses}</strong></article>
      <article><span>Success</span><strong>${formatPercent(stat.success, 1)}</strong></article>
      <article><span>Good</span><strong>${stat.goodWins}-${stat.goodLosses}</strong></article>
      <article><span>Evil</span><strong>${stat.evilWins}-${stat.evilLosses}</strong></article>
    </section>

    <section class="player-dialog-grid">
      <div class="player-stat-card">
        <h3>Spreadsheet Stats</h3>
        <div class="player-stat-list">
          ${spreadsheetStats.map(([label, value]) => `
            <div class="player-stat-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="player-stat-card">
        <h3>Roles</h3>
        <div class="role-chips">
          ${topRoles.length ? topRoles.map(([role, count]) => `<span class="chip">${escapeHtml(role)} ${count}</span>`).join("") : `<span class="leader-meta">No roles recorded.</span>`}
        </div>
      </div>
    </section>

    <section class="player-stat-card">
      <h3>Recent Games</h3>
      <div class="table-shell compact-table">
        <table>
          <thead><tr><th>Date</th><th>Role</th><th>Team</th><th>Result</th><th>Script</th></tr></thead>
          <tbody>
            ${recent.map(entry => `
              <tr>
                <td>${escapeHtml(entry.game.date)}</td>
                <td>${escapeHtml(entry.role || "--")}</td>
                <td>${escapeHtml(entry.alignment || "--")}</td>
                <td>${escapeHtml(entry.teamResult || entry.result || "--")}</td>
                <td>${escapeHtml(entry.game.script || "--")}</td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="empty-state">No games recorded.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderScriptFilter() {
  const scripts = [...new Set(getAllGames().map(game => game.script).filter(Boolean))].sort();
  const current = els.scriptFilter.value;
  els.scriptFilter.innerHTML = `<option value="">All scripts</option>${scripts.map(script => `<option>${escapeHtml(script)}</option>`).join("")}`;
  els.scriptFilter.value = scripts.includes(current) ? current : "";
}

function renderGames() {
  const script = els.scriptFilter.value;
  const rows = getAllGames()
    .filter(game => !script || game.script === script)
    .sort((a, b) => compareDates(b.date, a.date));

  els.gameTableBody.innerHTML = rows.map(game => `
    <tr class="clickable-row" data-select-game="${escapeHtml(game.id)}" tabindex="0">
      <td>${escapeHtml(game.date)}${game.source === "local" ? " *" : ""}</td>
      <td><span class="ratio ${game.outcome === "Good" ? "good" : "evil"}">${escapeHtml(game.outcome)}</span></td>
      <td>${escapeHtml(game.script || "--")}</td>
      <td>${escapeHtml(game.format || "--")}</td>
      <td>${game.playerCount || countParticipants(game)}</td>
      <td>${escapeHtml(game.storyteller || "--")}</td>
    </tr>
  `).join("") || `<tr><td colspan="6" class="empty-state">No games match this filter.</td></tr>`;

  els.gameTableBody.querySelectorAll("[data-select-game]").forEach(row => {
    row.addEventListener("click", () => openGameDialog(row.dataset.selectGame));
    row.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        openGameDialog(row.dataset.selectGame);
      }
    });
  });
}

function openGameDialog(gameId) {
  const game = getAllGames().find(item => item.id === gameId);
  if (!game) return;

  els.gameDialogName.textContent = `${game.date} ${game.script || "Game"}`;
  els.gameDialogContent.innerHTML = renderGameDialogContent(game);
  const deleteButton = els.gameDialogContent.querySelector("[data-delete-game-detail]");
  if (deleteButton) deleteButton.addEventListener("click", () => openDeleteDialog(game.id));
  els.gameDialog.showModal();
}

function renderGameDialogContent(game) {
  const participants = getGameParticipants(game);
  const winners = participants.filter(item => item.result === "Win");
  const losers = participants.filter(item => item.result === "Loss");

  return `
    <section class="player-dialog-summary">
      <article><span>Outcome</span><strong>${escapeHtml(game.outcome)}</strong></article>
      <article><span>Players</span><strong>${game.playerCount || countParticipants(game)}</strong></article>
      <article><span>Final Day</span><strong>${escapeHtml(game.finalDay || "--")}</strong></article>
      <article><span>Format</span><strong>${escapeHtml(game.format || "--")}</strong></article>
    </section>

    <section class="player-dialog-grid">
      <div class="player-stat-card">
        <h3>Game</h3>
        <div class="player-stat-list">
          ${[
            ["Date", game.date],
            ["Script", game.script || "--"],
            ["Storyteller", game.storyteller || "--"],
            ["Source", game.source || "--"],
            ["Winning team", winners.map(item => item.name).join(", ") || "--"],
            ["Losing team", losers.map(item => item.name).join(", ") || "--"],
          ].map(([label, value]) => `
            <div class="player-stat-row wide-stat-row">
              <span>${escapeHtml(label)}</span>
              <strong>${escapeHtml(value)}</strong>
            </div>
          `).join("")}
        </div>
      </div>

      <div class="player-stat-card">
        <h3>Roles</h3>
        <div class="role-chips">
          ${participants.map(item => `<span class="chip">${escapeHtml(item.role || "--")}</span>`).join("") || `<span class="leader-meta">No roles recorded.</span>`}
        </div>
      </div>
    </section>

    <section class="player-stat-card">
      <h3>Players</h3>
      <div class="table-shell compact-table">
        <table>
          <thead><tr><th>Player</th><th>Role</th><th>Team</th><th>Result</th><th>Traveler</th></tr></thead>
          <tbody>
            ${participants.map(item => `
              <tr>
                <td>${escapeHtml(item.name)}</td>
                <td>${escapeHtml(item.role || "--")}</td>
                <td>${escapeHtml(item.alignment || "--")}</td>
                <td>${escapeHtml(item.result || "--")}</td>
                <td>${item.isTraveler ? "Yes" : "No"}</td>
              </tr>
            `).join("") || `<tr><td colspan="5" class="empty-state">No players recorded.</td></tr>`}
          </tbody>
        </table>
      </div>
    </section>

    ${state.databaseAvailable ? `
      <div class="game-dialog-actions">
        <button class="danger-button" data-delete-game-detail="${escapeHtml(game.id)}" type="button">Delete game</button>
      </div>
    ` : ""}
  `;
}

function getGameParticipants(game) {
  const names = new Set([...Object.keys(game.roles), ...game.winNames, ...game.lossNames]);
  return [...names].sort((a, b) => a.localeCompare(b)).map(name => {
    const entry = getPlayerEntry(game, name);
    return {
      name,
      role: entry.role,
      alignment: entry.alignment,
      result: entry.result,
      isTraveler: entry.isTraveler,
    };
  });
}

function openDeleteDialog(gameId) {
  const game = getAllGames().find(item => item.id === gameId);
  if (!game) return;

  state.pendingDeleteGameId = game.id;
  els.deleteForm.reset();
  els.deleteMessage.textContent = "";
  els.deleteMessage.classList.remove("error");
  els.deleteGameName.textContent = `${game.date} ${game.script || "Game"}`;
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
  state.localGames = state.localGames.filter(game => game.id !== gameId);
  state.pendingDeleteGameId = "";
  els.deleteDialog.close();
  rebuild();
  setView("games");
}

function renderIssues() {
  if (!state.issues.length) {
    els.issuesPanel.innerHTML = `<h3>Data QA</h3><p class="leader-meta">No obvious ledger issues found.</p>`;
    return;
  }
  els.issuesPanel.innerHTML = `
    <h3>Data QA</h3>
    <ul class="issues-list">
      ${state.issues.slice(0, 8).map(issue => `<li>${escapeHtml(issue)}</li>`).join("")}
    </ul>
  `;
}

function findIssues(games, players) {
  const issues = [];
  games.forEach(game => {
    const listed = new Set([...game.winNames, ...game.lossNames]);
    Object.entries(game.roles).forEach(([player, role]) => {
      if (TRAVELER_ROLES.has(role)) return;
      if (!listed.has(player)) issues.push(`${game.date}: ${player} has ${role} but is not in Win or Loss.`);
    });
    listed.forEach(player => {
      if (!game.roles[player]) issues.push(`${game.date}: ${player} is listed in results but has no role recorded.`);
      if (!players.includes(player)) issues.push(`${game.date}: ${player} is not in the player header.`);
    });
  });
  return issues;
}

function renderDatalists() {
  els.playerOptions.innerHTML = state.players.map(player => `<option value="${escapeHtml(player)}"></option>`).join("");
  const roles = collectRoles(getAllGames());
  els.roleOptions.innerHTML = roles.map(role => `<option value="${escapeHtml(role)}"></option>`).join("");
  const scripts = [...new Set(getAllGames().map(game => game.script).filter(Boolean))].sort();
  els.scriptOptions.innerHTML = scripts.map(script => `<option value="${escapeHtml(script)}"></option>`).join("");
}

function collectRoles(games) {
  const roles = new Set([...GOOD_ROLES, ...EVIL_ROLES, ...TRAVELER_ROLES, ...state.draftRoles]);
  games.forEach(game => {
    Object.values(game.roles).forEach(role => {
      if (role) roles.add(role);
    });
  });
  return [...roles].sort((a, b) => a.localeCompare(b));
}

function firstActivePlayer() {
  return [...state.stats].sort((a, b) => b.games - a.games)[0]?.player || "";
}

function requestEntryUnlock() {
  els.passcodeForm.reset();
  els.passcodeMessage.textContent = "";
  els.passcodeMessage.classList.remove("error");
  els.passcodeDialog.showModal();
  window.setTimeout(() => els.passcodeInput.focus(), 0);
}

async function submitPasscode() {
  const passcode = els.passcodeInput.value;
  const unlocked = state.databaseAvailable
    ? await verifyServerPasscode(passcode)
    : passcode === getEntryPasscode();

  if (unlocked) {
    state.activePasscode = passcode;
    els.passcodeDialog.close();
    openEntryDialog();
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

function getEntryPasscode() {
  return DEFAULT_ENTRY_PASSCODE;
}

function openEntryDialog() {
  els.entryForm.reset();
  els.entryDate.valueAsDate = new Date();
  els.entryScript.value = "Trouble Brewing";
  els.newPlayerName.value = "";
  els.newRoleName.value = "";
  els.participantRows.innerHTML = "";
  for (let i = 0; i < 8; i += 1) addParticipantRow();
  els.entryMessage.textContent = "";
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

  const activeRoleInput = document.activeElement?.matches?.('[data-field="role"]')
    ? document.activeElement
    : null;
  const target = activeRoleInput || [...els.participantRows.querySelectorAll('[data-field="role"]')]
    .find(input => !clean(input.value)) || addParticipantRow().querySelector('[data-field="role"]');

  target.value = role;
  updateParticipantAlignmentFromRole(target.closest(".participant-row"));
  updateParticipantResult(target.closest(".participant-row"), { force: true });
  target.focus();
  els.newRoleName.value = "";
}

function addParticipantRow(data = {}) {
  const node = els.participantTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.alignmentManual = data.alignment && data.alignment !== "auto" ? "true" : "false";
  node.dataset.resultManual = data.result ? "true" : "false";
  node.querySelector('[data-field="name"]').value = data.name || "";
  node.querySelector('[data-field="role"]').value = data.role || "";
  node.querySelector('[data-field="alignment"]').value = data.alignment || "auto";
  node.querySelector('[data-field="result"]').value = data.result || "Loss";
  node.querySelector(".remove-participant").addEventListener("click", () => node.remove());
  node.querySelector('[data-field="role"]').addEventListener("change", () => {
    updateParticipantAlignmentFromRole(node);
    updateParticipantResult(node);
  });
  node.querySelector('[data-field="alignment"]').addEventListener("change", () => {
    node.dataset.alignmentManual = node.querySelector('[data-field="alignment"]').value === "auto" ? "false" : "true";
    updateParticipantResult(node);
  });
  node.querySelector('[data-field="result"]').addEventListener("change", () => {
    node.dataset.resultManual = "true";
  });
  els.participantRows.append(node);
  updateParticipantAlignmentFromRole(node);
  updateParticipantResult(node, { force: true });
  return node;
}

function updateParticipantAlignmentFromRole(row) {
  const role = clean(row.querySelector('[data-field="role"]').value);
  const alignment = row.querySelector('[data-field="alignment"]');
  if (row.dataset.alignmentManual === "true") return;

  const inferred = roleAlignment(role);
  if (TRAVELER_ROLES.has(role)) {
    alignment.value = "Good";
  } else {
    alignment.value = inferred || "auto";
  }
}

function updateParticipantResult(row, options = {}) {
  if (!options.force && row.dataset.resultManual === "true") return;

  const result = row.querySelector('[data-field="result"]');
  const alignment = resolveEntryAlignment(row);
  result.value = alignment === els.entryOutcome.value ? "Win" : "Loss";
}

function updateAllParticipantResults() {
  els.participantRows.querySelectorAll(".participant-row").forEach(row => updateParticipantResult(row));
}

function resolveEntryAlignment(row) {
  const role = clean(row.querySelector('[data-field="role"]').value);
  const alignmentValue = row.querySelector('[data-field="alignment"]').value;
  if (alignmentValue !== "auto") return alignmentValue;
  return roleAlignment(role) || "Good";
}

async function saveEntry() {
  const participants = [...els.participantRows.querySelectorAll(".participant-row")]
    .map(row => ({
      name: clean(row.querySelector('[data-field="name"]').value),
      role: clean(row.querySelector('[data-field="role"]').value),
      alignmentValue: row.querySelector('[data-field="alignment"]').value,
      resultValue: row.querySelector('[data-field="result"]').value,
    }))
    .filter(item => item.name && item.role);

  if (!els.entryDate.value || !participants.length) {
    els.entryMessage.textContent = "Date and at least one player are required.";
    els.entryMessage.classList.add("error");
    return;
  }
  const duplicateNames = participants
    .map(item => item.name)
    .filter((name, index, names) => names.indexOf(name) !== index);
  if (duplicateNames.length) {
    els.entryMessage.textContent = `Duplicate player: ${duplicateNames[0]}.`;
    els.entryMessage.classList.add("error");
    return;
  }
  els.entryMessage.classList.remove("error");

  const date = htmlDateToSheetDate(els.entryDate.value);
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

  const game = {
    id: `draft-${Date.now()}`,
    source: "draft",
    date,
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

  if (state.databaseAvailable) {
    try {
      const response = await fetch("/api/games", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ passcode: state.activePasscode, game }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        els.entryMessage.textContent = payload.error || "Could not save game.";
        els.entryMessage.classList.add("error");
        return;
      }
      state.games.push(payload.game);
    } catch {
      els.entryMessage.textContent = "Database server is unavailable.";
      els.entryMessage.classList.add("error");
      return;
    }
  } else {
    els.entryMessage.textContent = "Start node server.mjs to save to the repo database.";
    els.entryMessage.classList.add("error");
    return;
  }

  participants.forEach(item => {
    state.draftPlayers.add(item.name);
    state.draftRoles.add(item.role);
  });
  els.entryDialog.close();
  rebuild();
  setView("games");
}

function roleAlignment(role) {
  if (GOOD_ROLES.has(role)) return "Good";
  if (EVIL_ROLES.has(role)) return "Evil";
  return "";
}

function clearLocalEntries() {
  els.participantRows.innerHTML = "";
  for (let i = 0; i < 8; i += 1) addParticipantRow();
  els.entryMessage.textContent = "";
  els.entryMessage.classList.remove("error");
}

function downloadRecordCsv() {
  const players = collectPlayers(getAllGames());
  const headers = [...BASE_COLUMNS, ...players];
  const rows = [
    makeMetaRow(headers.length, getAllGames().length),
    headers,
    ...getAllGames().map(game => gameToRow(game, players)),
  ];
  downloadCsv("botc-record-export.csv", rows);
}

function makeMetaRow(length, gameCount) {
  const row = Array.from({ length }, () => "");
  row[0] = String(gameCount);
  row[2] = "Blood on the Clocktower: Psi Press Master Sheet";
  return row;
}

function gameToRow(game, players) {
  return [
    game.date,
    game.outcome,
    game.finalDay,
    game.storyteller,
    game.playerCount || countParticipants(game),
    game.format,
    game.script,
    game.winNames.join(", "),
    game.lossNames.join(", "),
    ...players.map(player => game.roles[player] || "n/a"),
  ];
}

function downloadStatsCsv() {
  const rows = [
    ["TRUE", ...state.players],
    ["Games Played", ...state.stats.map(stat => stat.games)],
    ["# of Evil Travels", ...state.stats.map(stat => stat.travelsEvil)],
    ["# of Good Travels", ...state.stats.map(stat => stat.travelsGood)],
    ["# of Wins", ...state.stats.map(stat => stat.wins)],
    ["# of Losses", ...state.stats.map(stat => stat.losses)],
    ["Success %", ...state.stats.map(stat => formatPercent(stat.success, 1))],
    ["Evil Games", ...state.stats.map(stat => stat.evilGames)],
    ["Evil Wins", ...state.stats.map(stat => stat.evilWins)],
    ["Evil Losses", ...state.stats.map(stat => stat.evilLosses)],
    ["Evil Winrate", ...state.stats.map(stat => formatPercent(stat.evilWinrate))],
    ["Evil Frequency", ...state.stats.map(stat => formatPercent(stat.evilFrequency))],
    ["Good Games", ...state.stats.map(stat => stat.goodGames)],
    ["Good Wins", ...state.stats.map(stat => stat.goodWins)],
    ["Good Losses", ...state.stats.map(stat => stat.goodLosses)],
    ["Good Winrate", ...state.stats.map(stat => formatPercent(stat.goodWinrate))],
    ["Good Frequency", ...state.stats.map(stat => formatPercent(stat.goodFrequency))],
  ];
  downloadCsv("botc-player-stats-export.csv", rows);
}

function downloadCsv(filename, rows) {
  const csv = rows.map(row => row.map(csvEscape).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function countParticipants(game) {
  return Object.values(game.roles).filter(role => role && !TRAVELER_ROLES.has(role)).length;
}

function compareDates(a, b) {
  return sheetDateValue(a) - sheetDateValue(b);
}

function sheetDateValue(value) {
  const parts = clean(value).split("/").map(Number);
  if (parts.length !== 3) return 0;
  const [month, day, year] = parts;
  const fullYear = year < 100 ? 2000 + year : year;
  return new Date(fullYear, month - 1, day).getTime();
}

function htmlDateToSheetDate(value) {
  const [year, month, day] = value.split("-");
  return `${Number(month)}/${Number(day)}/${year.slice(-2)}`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
