"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const pg = app.rdb({ schema: "public" });
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LEN = 6;
const CAT_KEYS = {
  "证件": "id",
  "电子": "elec",
  "衣物": "cloth",
  "洗漱": "wash",
  "药品": "med",
  "其他": "misc"
};
const SCENE_KEYS = {
  business: true,
  travel: true,
  home: true,
  camping: true,
  daytrip: true
};

function id(prefix) {
  return prefix + "_" + crypto.randomBytes(6).toString("hex");
}

function normalizeCat(cat) {
  const value = String(cat || "misc");
  return CAT_KEYS[value] || value;
}

function normalizeDays(days) {
  return Math.max(1, Math.min(30, Number(days) || 3));
}

function nicknameKey(nickname) {
  return String(nickname || "").trim().normalize("NFKC").toLowerCase();
}

function nicknameTaken(room, nickname) {
  const key = nicknameKey(nickname);
  return room.members.some(member => nicknameKey(member.nickname) === key);
}

function normalizeRoom(room) {
  if (!room || typeof room !== "object") return null;
  const normalized = Object.assign({}, room);
  normalized.scene = SCENE_KEYS[normalized.scene] ? normalized.scene : "business";
  normalized.days = normalizeDays(normalized.days);
  normalized.members = Array.isArray(normalized.members) ? normalized.members : [];
  normalized.items = Array.isArray(normalized.items) ? normalized.items : [];
  const seen = {};
  normalized.members.forEach(member => {
    let base = String(member.nickname || "队友").trim().slice(0, 16) || "队友";
    let candidate = base;
    let suffix = 2;
    while (seen[nicknameKey(candidate)]) {
      const tail = " " + suffix;
      candidate = base.slice(0, Math.max(1, 16 - tail.length)) + tail;
      suffix += 1;
    }
    member.nickname = candidate;
    seen[nicknameKey(candidate)] = true;
  });
  normalized.items.forEach(item => {
    item.cat = normalizeCat(item.cat);
    item.owner = item.owner || null;
    item.done = !!item.done;
    item.qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
  });
  return normalized;
}

function publicView(room) {
  return {
    code: room.code,
    teamName: room.teamName,
    tripName: room.tripName,
    scene: room.scene,
    days: room.days,
    version: room.version,
    updatedAt: room.updatedAt,
    members: room.members.map(member => ({
      id: member.id,
      nickname: member.nickname,
      joinedAt: member.joinedAt
    })),
    items: room.items.map(item => ({
      id: item.id,
      name: item.name,
      cat: normalizeCat(item.cat),
      qty: item.qty,
      owner: item.owner,
      done: item.done
    }))
  };
}

function findMember(room, memberId, token) {
  return room.members.find(member =>
    member.id === memberId && member.token === String(token || "")
  ) || null;
}

function findItem(room, itemId) {
  return room.items.find(item => item.id === itemId) || null;
}

function applyOps(room, memberId, ops) {
  const plan = [];
  for (let index = 0; index < ops.length; index += 1) {
    const op = ops[index];
    if (op.type === "claim") {
      const item = findItem(room, op.itemId);
      if (!item) return { ok: false, error: "item_not_found", op: index };
      if (item.owner && item.owner !== memberId && !op.force) {
        return { ok: false, error: "already_claimed", op: index, owner: item.owner };
      }
      plan.push({ kind: "claim", item, owner: op.unclaim ? null : memberId });
    } else if (op.type === "toggle") {
      const item = findItem(room, op.itemId);
      if (!item) return { ok: false, error: "item_not_found", op: index };
      plan.push({ kind: "toggle", item, done: !!op.done });
    } else if (op.type === "addItem") {
      if (op.base !== room.version) return { ok: false, error: "stale", op: index };
      const name = String(op.name || "").trim().slice(0, 40);
      if (!name) return { ok: false, error: "need_item_name", op: index };
      plan.push({
        kind: "addItem",
        item: {
          id: id("i"),
          name,
          cat: normalizeCat(op.cat),
          qty: Math.max(1, Math.min(99, Number(op.qty) || 1)),
          owner: memberId,
          done: false
        }
      });
    } else if (op.type === "removeItem") {
      const item = findItem(room, op.itemId);
      if (!item) return { ok: false, error: "item_not_found", op: index };
      if (op.base !== room.version) return { ok: false, error: "stale", op: index };
      plan.push({ kind: "removeItem", item });
    } else if (op.type === "renameTrip") {
      if (op.base !== room.version) return { ok: false, error: "stale", op: index };
      plan.push({
        kind: "renameTrip",
        tripName: String(op.tripName || "").trim().slice(0, 40)
      });
    } else {
      return { ok: false, error: "unknown_op", op: index };
    }
  }

  plan.forEach(action => {
    if (action.kind === "claim") action.item.owner = action.owner;
    else if (action.kind === "toggle") action.item.done = action.done;
    else if (action.kind === "addItem") room.items.push(action.item);
    else if (action.kind === "removeItem") {
      room.items = room.items.filter(item => item.id !== action.item.id);
    } else if (action.kind === "renameTrip") {
      room.tripName = action.tripName;
    }
  });
  return { ok: true };
}

async function readRoom(code) {
  const result = await pg.from("travel_rooms").select("*").eq("code", code).limit(1);
  if (result.error) throw result.error;
  const row = Array.isArray(result.data) ? result.data[0] : result.data;
  if (!row) return null;
  return normalizeRoom({
    code: row.code,
    teamName: row.team_name,
    tripName: row.trip_name,
    scene: row.scene,
    days: row.days,
    version: row.version,
    members: row.members,
    items: row.items,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at)
  });
}

function roomRow(room) {
  return {
    code: room.code,
    team_name: room.teamName,
    trip_name: room.tripName,
    scene: room.scene,
    days: room.days,
    version: room.version,
    members: room.members,
    items: room.items,
    created_at: room.createdAt,
    updated_at: room.updatedAt
  };
}

async function writeRoom(room, expectedVersion) {
  const result = await pg.from("travel_rooms")
    .update(roomRow(room))
    .eq("code", room.code)
    .eq("version", expectedVersion)
    .select("code");
  if (result.error) throw result.error;
  return Array.isArray(result.data) && result.data.length > 0;
}

async function createRoom(room) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    let code = "";
    for (let index = 0; index < CODE_LEN; index += 1) {
      code += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    const candidate = Object.assign({}, room, {
      code,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now()
    });
    const result = await pg.from("travel_rooms").insert([roomRow(candidate)]);
    if (!result.error) {
      return candidate;
    }
    if (String(result.error.code || "") !== "23505") throw result.error;
  }
  throw new Error("room code space exhausted");
}

async function updateRoom(code, mutate) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const room = await readRoom(code);
    if (!room) return { ok: false, status: 404, error: "room_not_found" };
    const expectedVersion = Number(room.version) || 0;
    const result = await mutate(room);
    if (result && result.ok === false) return result;
    room.version = expectedVersion + 1;
    room.updatedAt = Date.now();
    if (await writeRoom(room, expectedVersion)) {
      return { ok: true, room };
    }
  }
  return { ok: false, status: 409, error: "stale" };
}

function requestBody(event) {
  let body = event.body;
  if (event.isBase64Encoded && body) body = Buffer.from(body, "base64").toString("utf8");
  if (!body) return {};
  if (typeof body === "object") return body;
  try {
    return JSON.parse(body);
  } catch (error) {
    const parseError = new Error("bad_json");
    parseError.status = 400;
    throw parseError;
  }
}

function requestInfo(event) {
  const method = String(
    event.httpMethod ||
    event.method ||
    event.requestContext && event.requestContext.http && event.requestContext.http.method ||
    "GET"
  ).toUpperCase();
  let path = String(
    event.path ||
    event.rawPath ||
    event.requestContext && event.requestContext.path ||
    "/"
  );
  path = path.replace(/^\/api(?=\/|$)/, "") || "/";
  const query = Object.assign({}, event.queryStringParameters || {});
  if (!Object.keys(query).length && event.queryString) {
    String(event.queryString).split("&").forEach(pair => {
      const parts = pair.split("=");
      if (parts[0]) query[decodeURIComponent(parts[0])] = decodeURIComponent(parts[1] || "");
    });
  }
  return { method, path, query, body: requestBody(event) };
}

function response(statusCode, payload) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: payload === null ? "" : JSON.stringify(payload),
    isBase64Encoded: false
  };
}

function binaryResponse(statusCode, contentType, content) {
  return {
    statusCode,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": "inline",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    },
    body: content.toString("base64"),
    isBase64Encoded: true
  };
}

async function servePublicFile(requestPath) {
  const relative = requestPath === "/" ? "index.html" : requestPath.replace(/^\/+/, "");
  const allowed = {
    "index.html": "text/html; charset=utf-8",
    "出行清单MVP.html": "text/html; charset=utf-8",
    "manifest.json": "application/json; charset=utf-8",
    "sw.js": "application/javascript; charset=utf-8",
    "webclip.css": "text/css; charset=utf-8",
    "webclip.js": "application/javascript; charset=utf-8",
    "favicon.ico": "image/x-icon"
  };
  let contentType = allowed[relative];
  if (!contentType && /^icons\/[a-z0-9-]+\.png$/.test(relative)) contentType = "image/png";
  if (!contentType || relative.indexOf("..") >= 0) return null;
  try {
    const content = await fs.promises.readFile(path.join(__dirname, "public", relative));
    return binaryResponse(200, contentType, content);
  } catch (error) {
    return null;
  }
}

async function routeRequest(event) {
  const request = requestInfo(event);
  if (request.method === "OPTIONS") return response(204, null);

  if (request.method === "GET") {
    const fileResponse = await servePublicFile(request.path);
    if (fileResponse) return fileResponse;
  }

  if (request.method === "GET" && request.path === "/health") {
    return response(200, { ok: true });
  }

  if (request.method === "POST" && request.path === "/create") {
    const body = request.body;
    const nickname = String(body.nickname || "").trim().slice(0, 16);
    if (!nickname) return response(400, { ok: false, error: "need_nickname" });
    const memberId = id("m");
    const memberToken = crypto.randomBytes(24).toString("hex");
    const room = await createRoom({
      teamName: String(body.teamName || "我们的出行清单").trim().slice(0, 20),
      tripName: String(body.tripName || "出行清单").trim().slice(0, 40),
      scene: SCENE_KEYS[body.scene] ? body.scene : "business",
      days: normalizeDays(body.days),
      members: [{
        id: memberId,
        token: memberToken,
        nickname,
        joinedAt: Date.now(),
        isCreator: true
      }],
      items: (Array.isArray(body.items) ? body.items : []).slice(0, 200).map(item => ({
        id: id("i"),
        name: String(item.name || "").trim().slice(0, 40),
        cat: normalizeCat(item.cat),
        qty: Math.max(1, Math.min(99, Number(item.qty) || 1)),
        owner: null,
        done: false
      })).filter(item => !!item.name)
    });
    return response(200, {
      ok: true,
      memberId,
      memberToken,
      room: publicView(normalizeRoom(room))
    });
  }

  if (request.method === "POST" && request.path === "/join") {
    const body = request.body;
    const code = String(body.code || "").trim().toUpperCase();
    const nickname = String(body.nickname || "").trim().slice(0, 16);
    if (!nickname) return response(400, { ok: false, error: "need_nickname" });
    const memberId = id("m");
    const memberToken = crypto.randomBytes(24).toString("hex");
    const result = await updateRoom(code, room => {
      if (nicknameTaken(room, nickname)) {
        return { ok: false, status: 409, error: "nickname_taken" };
      }
      if (room.members.length >= 10) {
        return { ok: false, status: 409, error: "room_full" };
      }
      room.members.push({
        id: memberId,
        token: memberToken,
        nickname,
        joinedAt: Date.now(),
        isCreator: false
      });
    });
    if (!result.ok) return response(result.status || 409, result);
    return response(200, {
      ok: true,
      memberId,
      memberToken,
      room: publicView(result.room)
    });
  }

  if (request.method === "GET" && request.path === "/room") {
    const code = String(request.query.code || "").toUpperCase();
    const since = Number(request.query.since || 0);
    const room = await readRoom(code);
    if (!room) return response(404, { ok: false, error: "room_not_found" });
    if (since === room.version) {
      return response(200, { ok: true, changed: false, version: room.version });
    }
    return response(200, { ok: true, changed: true, room: publicView(room) });
  }

  if (request.method === "POST" && request.path === "/ops") {
    const body = request.body;
    const code = String(body.code || "").toUpperCase();
    const result = await updateRoom(code, room => {
      if (!findMember(room, String(body.memberId || ""), body.memberToken)) {
        return { ok: false, status: 403, error: "not_member" };
      }
      const ops = Array.isArray(body.ops) ? body.ops : [];
      if (!ops.length) return { ok: true, noWrite: true };
      return applyOps(room, body.memberId, ops);
    });
    if (!result.ok) {
      return response(result.status || 409, Object.assign({}, result, {
        version: result.room ? result.room.version : undefined
      }));
    }
    if (result.noWrite) {
      return response(200, { ok: true, version: result.room.version, room: publicView(result.room) });
    }
    return response(200, { ok: true, version: result.room.version, room: publicView(result.room) });
  }

  if (request.method === "POST" && request.path === "/leave") {
    const body = request.body;
    const code = String(body.code || "").toUpperCase();
    const result = await updateRoom(code, room => {
      const member = findMember(room, String(body.memberId || ""), body.memberToken);
      if (!member) return { ok: false, status: 403, error: "not_member" };
      room.members = room.members.filter(item => item.id !== member.id);
      room.items.forEach(item => {
        if (item.owner === member.id) item.owner = null;
      });
    });
    if (!result.ok) return response(result.status || 409, result);
    return response(200, {
      ok: true,
      version: result.room.version,
      room: publicView(result.room)
    });
  }

  return response(404, { ok: false, error: "no_route", path: request.path });
}

exports.main = async event => {
  try {
    return await routeRequest(event || {});
  } catch (error) {
    return response(error.status || 500, {
      ok: false,
      error: String(error.message || error)
    });
  }
};
