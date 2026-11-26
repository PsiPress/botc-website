// Data layer for the Supabase backend: sign-in, reads, editor writes and photo
// storage, over Supabase's REST endpoints (no client library). Shapes rows
// into the objects app.js uses. Schema and permissions: supabase/setup.sql.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js?v=20261126";

const BASE = String(SUPABASE_URL || "").trim().replace(/\/+$/, "");
const KEY = String(SUPABASE_PUBLISHABLE_KEY || "").trim();
const SESSION_KEY = "botc.supabase.session";
const BUCKET = "media";
const PAGE = 1000;

export const supabaseEnabled = Boolean(BASE && KEY) && !isSecretKey(KEY);
if (BASE && KEY && !supabaseEnabled) {
  console.error("supabase-config.js holds a secret key. Use the publishable (anon) key instead; the site stays read-only until then.");
}

export class SupabaseError extends Error {
  constructor(message, status = 0, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ---------------------------------------------------------------- session */

let session = readSession();
let refreshing = null;

export function currentUser() {
  return session?.user || null;
}

export async function signIn(email, password) {
  storeAuth(await request("/auth/v1/token?grant_type=password", { method: "POST", body: { email, password }, auth: false }));
  return session.user;
}

export async function signOut() {
  const previous = session;
  writeSession(null);
  if (!previous) return;
  try {
    await fetch(`${BASE}/auth/v1/logout`, { method: "POST", headers: { apikey: KEY, Authorization: `Bearer ${previous.access_token}` } });
  } catch {
    // The local session is gone either way.
  }
}

export async function isEditor() {
  if (!session) return false;
  try {
    return (await request("/rest/v1/rpc/is_editor", { method: "POST", body: {} })) === true;
  } catch (error) {
    if (error.status === 401) writeSession(null);
    return false;
  }
}

async function freshSession() {
  if (!session) return null;
  if (session.expires_at * 1000 - Date.now() > 60_000) return session;
  refreshing ||= request("/auth/v1/token?grant_type=refresh_token", { method: "POST", body: { refresh_token: session.refresh_token }, auth: false })
    .then(storeAuth)
    .finally(() => { refreshing = null; });
  try {
    await refreshing;
  } catch {
    writeSession(null);
    throw new SupabaseError("Signed out. Sign in again.", 401);
  }
  return session;
}

function storeAuth(data) {
  writeSession({
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
    user: { id: data.user?.id || "", email: data.user?.email || "" },
  });
}

function readSession() {
  try {
    const stored = JSON.parse(globalThis.localStorage?.getItem(SESSION_KEY) || "null");
    return stored?.access_token && stored?.refresh_token ? stored : null;
  } catch {
    return null;
  }
}

function writeSession(value) {
  session = value;
  try {
    if (value) globalThis.localStorage?.setItem(SESSION_KEY, JSON.stringify(value));
    else globalThis.localStorage?.removeItem(SESSION_KEY);
  } catch {
    // Private browsing: the session lasts until the tab closes.
  }
}

/* ---------------------------------------------------------------- requests */

async function request(path, { method = "GET", body, headers = {}, auth = true, withHeaders = false } = {}) {
  const sendHeaders = { apikey: KEY, ...headers };
  if (auth) {
    const active = await freshSession();
    if (active) sendHeaders.Authorization = `Bearer ${active.access_token}`;
  }
  // Legacy anon keys are JWTs and go in Authorization too; publishable keys do not.
  if (!sendHeaders.Authorization && jwtPayload(KEY)) sendHeaders.Authorization = `Bearer ${KEY}`;
  let payloadBody = body;
  if (body !== undefined && !(body instanceof Blob)) {
    sendHeaders["Content-Type"] = "application/json";
    payloadBody = JSON.stringify(body);
  }
  const response = await fetch(`${BASE}${path}`, { method, headers: sendHeaders, body: payloadBody, cache: "no-store" });
  const text = await response.text();
  let payload = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }
  if (!response.ok) throw new SupabaseError(errorMessage(payload, response.status), response.status, payload?.code || "");
  return withHeaders ? { payload, headers: response.headers } : payload;
}

function errorMessage(payload, status) {
  if (payload && typeof payload === "object") {
    if (payload.code === "42501" || /row-level security/i.test(payload.message || "")) return "Not allowed: this account isn't a member.";
    if (payload.code === "23505") return "That already exists.";
    const message = payload.message || payload.msg || payload.error_description || payload.error;
    if (message) return String(message);
  }
  if (typeof payload === "string" && payload.trim()) return payload.trim().slice(0, 200);
  return `Request failed (${status}).`;
}

async function selectAll(table, order) {
  const query = `/rest/v1/${table}?select=*&order=${order}`;
  const first = await request(`${query}&limit=${PAGE}&offset=0`, { auth: false, headers: { Prefer: "count=exact" }, withHeaders: true });
  const rows = [...first.payload];
  const total = Number((first.headers.get("content-range") || "").split("/")[1]);
  while (Number.isFinite(total) && rows.length < total) {
    const page = await request(`${query}&limit=${PAGE}&offset=${rows.length}`, { auth: false });
    if (!page.length) break;
    rows.push(...page);
  }
  return rows;
}

async function insertRow(table, row) {
  const rows = await request(`/rest/v1/${table}`, { method: "POST", body: row, headers: { Prefer: "return=representation" } });
  return rows[0];
}

async function updateRow(table, column, value, patch) {
  const rows = await request(`/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`, {
    method: "PATCH", body: patch, headers: { Prefer: "return=representation" },
  });
  if (!rows.length) throw new SupabaseError("Not found, or this account cannot edit it.", 404);
  return rows[0];
}

async function deleteRow(table, column, value) {
  const rows = await request(`/rest/v1/${table}?${column}=eq.${encodeURIComponent(value)}`, {
    method: "DELETE", headers: { Prefer: "return=representation" },
  });
  if (!rows.length) throw new SupabaseError("Not found, or this account cannot delete it.", 404);
  return rows[0];
}

/* ---------------------------------------------------------------- site data */

export async function loadSiteState() {
  const [games, players, events, photos] = await Promise.all([
    selectAll("games", "seq.asc"),
    selectAll("players", "slot.asc.nullslast,name.asc"),
    selectAll("events", "starts_at.asc"),
    selectAll("photos", "created_at.desc"),
  ]);
  return {
    games: games.map(rowToGame),
    players: players.map(rowToPlayer),
    events: events.map(rowToEvent),
    photos: photos.map(rowToPhoto),
  };
}

export async function saveGame(game, id = "") {
  const row = {
    date: game.date,
    outcome: game.outcome,
    final_day: game.finalDay,
    storyteller: game.storyteller,
    player_count: game.playerCount,
    format: game.format,
    script: game.script,
    win_names: game.winNames,
    loss_names: game.lossNames,
    roles: game.roles,
    alignment_overrides: game.alignmentOverrides,
    mango_nectar: game.mangoNectar || [],
    mushroom_elixir: game.mushroomElixir || [],
  };
  return rowToGame(id ? await updateRow("games", "id", id, row) : await insertRow("games", row));
}

export async function deleteGame(id) {
  await deleteRow("games", "id", id);
}

// `existingName` is set when editing; a new player is inserted and gets the next slot.
export async function savePlayer(profile, existingName = "") {
  const row = {
    display_name: profile.displayName,
    core: Boolean(profile.core),
    title: profile.title,
    major: profile.major,
    status: profile.status,
    quote: profile.quote,
    photo_path: profile.photoPath,
    overall_skill: profile.overallSkill,
    good_skill: profile.goodSkill,
    evil_skill: profile.evilSkill,
    game_impact: profile.gameImpact,
    social_trust: profile.socialTrust,
    strengths: profile.strengths,
    weaknesses: profile.weaknesses,
  };
  Object.keys(row).forEach(key => { if (row[key] === undefined) delete row[key]; });
  if (existingName) return rowToPlayer(await updateRow("players", "name", existingName, row));
  return rowToPlayer(await insertRow("players", { name: profile.name, ...row }));
}

export async function saveEvent(event, id = "") {
  const row = {
    title: event.title,
    starts_at: event.startsAt,
    location: event.location,
    format: event.format,
    script: event.script,
    storyteller: event.storyteller,
    notes: event.notes,
  };
  return rowToEvent(id ? await updateRow("events", "id", id, row) : await insertRow("events", row));
}

export async function deleteEvent(id) {
  await deleteRow("events", "id", id);
}

export async function savePhoto(photo, id = "") {
  const row = { caption: photo.caption, taken_on: photo.takenOn || null };
  if (!id) Object.assign(row, { path: photo.path, width: photo.width || null, height: photo.height || null });
  return rowToPhoto(id ? await updateRow("photos", "id", id, row) : await insertRow("photos", row));
}

export async function deletePhoto(photo) {
  await deleteRow("photos", "id", photo.id);
  await deleteMedia(photo.path).catch(error => console.warn("Photo row deleted but the file was not:", error));
}

/* ---------------------------------------------------------------- storage */

export async function uploadMedia(path, blob) {
  await request(`/storage/v1/object/${BUCKET}/${encodePath(path)}`, {
    method: "POST",
    body: blob,
    headers: { "Content-Type": blob.type || "application/octet-stream", "x-upsert": "false", "cache-control": "max-age=31536000" },
  });
  return path;
}

export async function deleteMedia(path) {
  if (!path) return;
  await request(`/storage/v1/object/${BUCKET}`, { method: "DELETE", body: { prefixes: [path] } });
}

export function mediaUrl(path) {
  return path && BASE ? `${BASE}/storage/v1/object/public/${BUCKET}/${encodePath(path)}` : "";
}

/* ---------------------------------------------------------------- rows */

function rowToGame(row) {
  return {
    id: row.id,
    source: row.source,
    date: row.date,
    outcome: row.outcome,
    finalDay: row.final_day || "",
    storyteller: row.storyteller || "",
    playerCount: row.player_count,
    format: row.format || "",
    script: row.script || "",
    winNames: row.win_names || [],
    lossNames: row.loss_names || [],
    roles: row.roles || {},
    alignmentOverrides: row.alignment_overrides || {},
    mangoNectar: row.mango_nectar || [],
    mushroomElixir: row.mushroom_elixir || [],
  };
}

function rowToPlayer(row) {
  return {
    name: row.name,
    slot: row.slot,
    displayName: row.display_name || "",
    core: Boolean(row.core),
    title: row.title || "",
    major: row.major || "",
    status: row.status || "",
    quote: row.quote || "",
    photoPath: row.photo_path || "",
    overallSkill: row.overall_skill || "",
    goodSkill: row.good_skill || "",
    evilSkill: row.evil_skill || "",
    gameImpact: row.game_impact || "",
    socialTrust: row.social_trust || "",
    strengths: row.strengths || "",
    weaknesses: row.weaknesses || "",
  };
}

function rowToEvent(row) {
  return {
    id: row.id,
    title: row.title,
    startsAt: row.starts_at,
    location: row.location || "",
    format: row.format || "",
    script: row.script || "",
    storyteller: row.storyteller || "",
    notes: row.notes || "",
  };
}

function rowToPhoto(row) {
  return {
    id: row.id,
    path: row.path,
    caption: row.caption || "",
    takenOn: row.taken_on || "",
    width: row.width || 0,
    height: row.height || 0,
    createdAt: row.created_at,
  };
}

/* ---------------------------------------------------------------- helpers */

function encodePath(path) {
  return String(path).split("/").map(encodeURIComponent).join("/");
}

function jwtPayload(token) {
  const parts = String(token).split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch {
    return null;
  }
}

function isSecretKey(key) {
  return key.startsWith("sb_secret_") || jwtPayload(key)?.role === "service_role";
}
