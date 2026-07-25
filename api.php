<?php
declare(strict_types=1);

const DEFAULT_PASSCODE = 'psip';
const GAMES_SHEET = __DIR__ . '/Blood on the Clocktower - Games Sheet.csv';
const DATABASE_PATH = __DIR__ . '/data/botc.sqlite';
const BASE_COLUMN_COUNT = 8;
const NORMALIZED_HEADERS = ['', 'Outcome', 'Final Day', 'Storyteller', 'Player Count', 'Format', 'Script', 'Win', 'Loss'];

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

try {
    $db = openDatabase();
    synchronizeGamesSheet($db);
    routeRequest($db);
} catch (InvalidArgumentException $error) {
    sendJson(400, ['error' => $error->getMessage()]);
} catch (Throwable $error) {
    error_log((string) $error);
    sendJson(500, ['error' => 'Internal server error.']);
}

function routeRequest(PDO $db): never
{
    $route = $_GET['route'] ?? '';
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

    if ($route === 'state' && $method === 'GET') {
        $sheet = readGamesSheet();
        sendJson(200, ['headers' => gamesSheetState($sheet)['headers'], 'games' => getGames($db), 'storage' => 'sqlite']);
    }

    if ($route === 'unlock' && $method === 'POST') {
        $body = readJsonBody();
        $valid = hash_equals(DEFAULT_PASSCODE, (string) ($body['passcode'] ?? ''));
        sendJson($valid ? 200 : 401, ['ok' => $valid]);
    }

    if ($route === 'games' && in_array($method, ['POST', 'PUT', 'DELETE'], true)) {
        $body = readJsonBody();
        if (!hash_equals(DEFAULT_PASSCODE, (string) ($body['passcode'] ?? ''))) {
            sendJson(401, ['error' => 'Passcode required.']);
        }

        if ($method === 'POST') {
            $game = normalizeGame($body['game'] ?? [], 'game-' . uuidV4(), 'database');
            insertGame($db, $game);
            sendJson(201, ['game' => $game]);
        }

        $id = trim((string) ($_GET['id'] ?? ''));
        $existing = $id === '' ? null : getGameById($db, $id);
        if ($existing === null) {
            sendJson(404, ['error' => 'Game not found.']);
        }

        if ($method === 'PUT') {
            $game = normalizeGame($body['game'] ?? [], $id, $existing['source'] ?: 'database');
            updateGame($db, $game);
            sendJson(200, ['game' => $game]);
        }

        $statement = $db->prepare('DELETE FROM games WHERE id = ?');
        $statement->execute([$id]);
        sendJson(200, ['ok' => true]);
    }

    sendJson(404, ['error' => 'Not found.']);
}

function openDatabase(): PDO
{
    $directory = dirname(DATABASE_PATH);
    if (!is_dir($directory) && !mkdir($directory, 0775, true) && !is_dir($directory)) {
        throw new RuntimeException('Unable to create the data directory.');
    }
    $db = new PDO('sqlite:' . DATABASE_PATH, null, null, [
        PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    $db->exec('PRAGMA busy_timeout = 5000; PRAGMA journal_mode = WAL;');
    $db->exec("CREATE TABLE IF NOT EXISTS games (
        id TEXT PRIMARY KEY, source TEXT NOT NULL, date TEXT NOT NULL, outcome TEXT NOT NULL,
        final_day TEXT, storyteller TEXT, player_count INTEGER NOT NULL, format TEXT, script TEXT,
        win_names TEXT NOT NULL, loss_names TEXT NOT NULL, roles TEXT NOT NULL,
        alignment_overrides TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
    ); CREATE TABLE IF NOT EXISTS import_metadata (source TEXT PRIMARY KEY, content_hash TEXT NOT NULL);");
    return $db;
}

function synchronizeGamesSheet(PDO $db): void
{
    $hash = hash_file('sha256', GAMES_SHEET);
    if ($hash === false) {
        throw new RuntimeException('Unable to read the Games Sheet.');
    }
    $previous = $db->query("SELECT content_hash FROM import_metadata WHERE source = 'games-sheet'")->fetchColumn();
    $legacyCount = (int) $db->query("SELECT COUNT(*) FROM games WHERE source = 'record'")->fetchColumn();
    if ($previous === $hash && $legacyCount === 0) {
        return;
    }

    $state = gamesSheetState(readGamesSheet());
    $db->beginTransaction();
    try {
        $db->exec("DELETE FROM games WHERE source IN ('record', 'games-sheet')");
        foreach ($state['games'] as $game) {
            insertGame($db, $game);
        }
        $statement = $db->prepare('INSERT OR REPLACE INTO import_metadata (source, content_hash) VALUES (?, ?)');
        $statement->execute(['games-sheet', $hash]);
        $db->commit();
    } catch (Throwable $error) {
        $db->rollBack();
        throw $error;
    }
}

function readGamesSheet(): array
{
    $handle = fopen(GAMES_SHEET, 'rb');
    if ($handle === false) {
        throw new RuntimeException('Unable to open the Games Sheet.');
    }
    $rows = [];
    while (($row = fgetcsv($handle, null, ',', '"', '')) !== false) {
        $rows[] = array_map('clean', $row);
    }
    fclose($handle);
    $headers = $rows[1] ?? [];
    $dataRows = [];
    foreach (array_slice($rows, 2) as $row) {
        if (clean($row[0] ?? '') === '' || clean($row[1] ?? '') === '') continue;
        $row[0] = csvDateToDisplay($row[0]);
        $dataRows[] = $row;
    }
    return ['headers' => $headers, 'rows' => $dataRows];
}

function gamesSheetState(array $sheet): array
{
    $playerHeaders = array_slice($sheet['headers'], BASE_COLUMN_COUNT);
    $games = [];
    foreach ($sheet['rows'] as $index => $row) {
        $roles = [];
        foreach ($playerHeaders as $offset => $player) {
            $role = clean($row[$offset + BASE_COLUMN_COUNT] ?? '');
            if ($role !== '' && strtolower($role) !== 'n/a') $roles[$player] = $role;
        }
        $games[] = [
            'id' => "games-sheet-$index", 'source' => 'games-sheet', 'date' => clean($row[0] ?? ''),
            'outcome' => clean($row[1] ?? ''), 'finalDay' => finalDayValue($row[2] ?? ''),
            'storyteller' => clean($row[3] ?? ''), 'playerCount' => (int) clean($row[4] ?? '0'),
            'format' => '', 'script' => clean($row[5] ?? ''), 'winNames' => splitNames($row[6] ?? ''),
            'lossNames' => splitNames($row[7] ?? ''), 'roles' => $roles, 'alignmentOverrides' => [],
        ];
    }
    return ['headers' => array_merge(NORMALIZED_HEADERS, $playerHeaders), 'games' => $games];
}

function getGames(PDO $db): array
{
    return array_map('rowToGame', $db->query('SELECT * FROM games ORDER BY rowid')->fetchAll());
}

function getGameById(PDO $db, string $id): ?array
{
    $statement = $db->prepare('SELECT * FROM games WHERE id = ?');
    $statement->execute([$id]);
    $row = $statement->fetch();
    return $row === false ? null : rowToGame($row);
}

function rowToGame(array $row): array
{
    return [
        'id' => $row['id'], 'source' => $row['source'], 'date' => $row['date'], 'outcome' => $row['outcome'],
        'finalDay' => $row['final_day'] ?: '', 'storyteller' => $row['storyteller'] ?: '',
        'playerCount' => (int) $row['player_count'], 'format' => $row['format'] ?: '', 'script' => $row['script'] ?: '',
        'winNames' => json_decode($row['win_names'], true, 512, JSON_THROW_ON_ERROR),
        'lossNames' => json_decode($row['loss_names'], true, 512, JSON_THROW_ON_ERROR),
        'roles' => json_decode($row['roles'], true, 512, JSON_THROW_ON_ERROR),
        'alignmentOverrides' => json_decode($row['alignment_overrides'], true, 512, JSON_THROW_ON_ERROR),
    ];
}

function normalizeGame(mixed $input, string $id, string $source): array
{
    $game = is_array($input) ? $input : [];
    $date = clean($game['date'] ?? '');
    $outcome = clean($game['outcome'] ?? '');
    if ($date === '' || !in_array($outcome, ['Good', 'Evil'], true)) {
        throw new InvalidArgumentException('Invalid game payload.');
    }
    $roles = is_array($game['roles'] ?? null) ? $game['roles'] : [];
    $alignments = is_array($game['alignmentOverrides'] ?? null) ? $game['alignmentOverrides'] : [];
    return [
        'id' => $id, 'source' => $source, 'date' => $date, 'outcome' => $outcome,
        'finalDay' => clean($game['finalDay'] ?? ''), 'storyteller' => clean($game['storyteller'] ?? ''),
        'playerCount' => is_numeric($game['playerCount'] ?? null) ? (int) $game['playerCount'] : count($roles),
        'format' => clean($game['format'] ?? ''), 'script' => clean($game['script'] ?? ''),
        'winNames' => cleanList($game['winNames'] ?? []), 'lossNames' => cleanList($game['lossNames'] ?? []),
        'roles' => $roles, 'alignmentOverrides' => $alignments,
    ];
}

function insertGame(PDO $db, array $game): void
{
    $now = gmdate('c');
    $statement = $db->prepare('INSERT INTO games (id, source, date, outcome, final_day, storyteller, player_count, format, script, win_names, loss_names, roles, alignment_overrides, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
    $statement->execute(gameValues($game, $now, true));
}

function updateGame(PDO $db, array $game): void
{
    $values = gameValues($game, gmdate('c'), false);
    $statement = $db->prepare('UPDATE games SET date=?, outcome=?, final_day=?, storyteller=?, player_count=?, format=?, script=?, win_names=?, loss_names=?, roles=?, alignment_overrides=?, updated_at=? WHERE id=?');
    $statement->execute($values);
}

function gameValues(array $game, string $now, bool $insert): array
{
    $data = [$game['date'], $game['outcome'], $game['finalDay'], $game['storyteller'], $game['playerCount'], $game['format'], $game['script'], json_encode($game['winNames'], JSON_THROW_ON_ERROR), json_encode($game['lossNames'], JSON_THROW_ON_ERROR), json_encode($game['roles'], JSON_THROW_ON_ERROR), json_encode($game['alignmentOverrides'], JSON_THROW_ON_ERROR)];
    return $insert ? array_merge([$game['id'], $game['source']], $data, [$now, $now]) : array_merge($data, [$now, $game['id']]);
}

function readJsonBody(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 1_000_000) throw new InvalidArgumentException('Invalid request body.');
    if ($raw === '') return [];
    $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if (!is_array($body)) throw new InvalidArgumentException('Invalid request body.');
    return $body;
}

function sendJson(int $status, array $payload): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    exit;
}

function clean(mixed $value): string { return trim((string) ($value ?? '')); }
function cleanList(mixed $values): array { return is_array($values) ? array_values(array_filter(array_map('clean', $values), fn($value) => $value !== '')) : []; }
function splitNames(mixed $value): array { return cleanList(explode(',', clean($value))); }
function csvDateToDisplay(mixed $value): string { return preg_replace('/^(\d{1,2})\/(\d{1,2})\/(\d{2})\d{2}$/', '$1/$2/$3', clean($value)) ?? clean($value); }
function finalDayValue(mixed $value): string { $day = strtolower(clean($value)); return $day === 'true' ? '1' : ($day === 'false' ? '0' : $day); }
function uuidV4(): string { $bytes = random_bytes(16); $bytes[6] = chr((ord($bytes[6]) & 0x0f) | 0x40); $bytes[8] = chr((ord($bytes[8]) & 0x3f) | 0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($bytes), 4)); }
