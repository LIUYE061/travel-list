/**
 * 组队清单 · 本地同步服务（开发期替身）
 *
 * 为什么不用 WebSocket / SSE：正式方案定腾讯云开发 CloudBase，而它在本项目中
 * 刻意采用**轮询**而非 watch —— 免费档与个人版的实时推送并发都只有 10 个连接
 * （每个客户端一次 .watch() 占 1 个），而打包行为是短时突发，轮询足够且不吃连接数。
 * 本服务因此只提供 GET/POST + 版本号，语义与"轮询一条房间文档"完全一致，
 * 将来换成 CloudBase 只改前端 transport 一个函数。
 *
 * 冲突规则（全部在服务端裁决，客户端不做乐观合并）：
 *   claim   先到先得，已被他人认领则拒绝（除非 force）
 *   toggle  各自独立，无冲突
 *   edit    带 base 版本号，落后则拒绝（防覆盖他人刚做的改动）
 *   remove  带 base 版本号，同上
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.argv[2] || 8787);
const DATA_DIR = path.join(__dirname, ".teamdata");
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // 去掉易混的 I O 0 1
const CODE_LEN = 6;
const CAT_KEYS = { "证件": "id", "电子": "elec", "衣物": "cloth", "洗漱": "wash", "药品": "med", "其他": "misc" };
const SCENE_KEYS = { business: 1, travel: 1, home: 1, camping: 1, daytrip: 1 };
const PUBLIC_FILES = {
  "index.html": "text/html; charset=utf-8",
  "出行清单MVP.html": "text/html; charset=utf-8",
  "manifest.json": "application/json; charset=utf-8",
  "sw.js": "application/javascript; charset=utf-8",
  "webclip.css": "text/css; charset=utf-8",
  "webclip.js": "application/javascript; charset=utf-8",
  "favicon.ico": "image/x-icon",
};

fs.mkdirSync(DATA_DIR, { recursive: true });

function roomPath(code) {
  return path.join(DATA_DIR, code + ".json");
}
function normalizeCat(cat) {
  var value = String(cat || "misc");
  return CAT_KEYS[value] || value;
}
function normalizeDays(days) {
  return Math.max(1, Math.min(30, Number(days) || 3));
}
function normalizeRoom(room) {
  if (!room || typeof room !== "object") return null;
  room.scene = SCENE_KEYS[room.scene] ? room.scene : "business";
  room.days = normalizeDays(room.days);
  if (!Array.isArray(room.members)) room.members = [];
  if (!Array.isArray(room.items)) room.items = [];
  room.members.forEach(function (member) {
    if (!member.token) member.token = crypto.randomBytes(24).toString("hex");
  });
  room.items.forEach(function (item) {
    item.cat = normalizeCat(item.cat);
    item.owner = item.owner || null;
    item.done = !!item.done;
    item.qty = Math.max(1, Math.min(99, Number(item.qty) || 1));
  });
  return room;
}
function loadRoom(code) {
  try {
    return normalizeRoom(JSON.parse(fs.readFileSync(roomPath(code), "utf8")));
  } catch (e) {
    return null;
  }
}
function saveRoom(room) {
  fs.writeFileSync(roomPath(room.code), JSON.stringify(room, null, 2), "utf8");
}
function newCode() {
  for (let i = 0; i < 40; i++) {
    let s = "";
    for (let j = 0; j < CODE_LEN; j++) {
      s += CODE_ALPHABET[crypto.randomInt(CODE_ALPHABET.length)];
    }
    if (!loadRoom(s)) return s;
  }
  throw new Error("room code space exhausted");
}
function id(prefix) {
  return prefix + "_" + crypto.randomBytes(6).toString("hex");
}

/** 客户端只需要这些字段，成员的内部 token 不外泄 */
function publicView(room) {
  return {
    code: room.code,
    teamName: room.teamName,
    tripName: room.tripName,
    scene: room.scene,
    days: room.days,
    version: room.version,
    updatedAt: room.updatedAt,
    members: room.members.map(function (m) {
      return { id: m.id, nickname: m.nickname, joinedAt: m.joinedAt };
    }),
    items: room.items.map(function (it) {
      return {
        id: it.id,
        name: it.name,
        cat: normalizeCat(it.cat),
        qty: it.qty,
        owner: it.owner,
        done: it.done,
      };
    }),
  };
}

function findMember(room, memberId, token) {
  for (var i = 0; i < room.members.length; i++) {
    if (room.members[i].id === memberId && room.members[i].token === String(token || "")) {
      return room.members[i];
    }
  }
  return null;
}
function findItem(room, itemId) {
  for (var i = 0; i < room.items.length; i++) {
    if (room.items[i].id === itemId) return room.items[i];
  }
  return null;
}

function bump(room) {
  room.version += 1;
  room.updatedAt = Date.now();
  saveRoom(room);
}

/**
 * 应用一批操作。任何一条被拒就整批不生效（先全量校验再写入），
 * 避免"改了一半"导致客户端版本号推进了但状态不一致。
 *
 * 注意：这里刻意不用闭包暂存待办。var 是函数作用域，循环里捕获的 `it`
 * 在循环结束后全部指向最后一次赋值，一批改两件物品会都改到同一件上。
 * 因此 plan 存**数据**（对象 + 目标引用），第二段循环再按 kind 分派执行。
 */
function applyOps(room, memberId, ops) {
  var plan = [];
  for (var i = 0; i < ops.length; i++) {
    var op = ops[i];
    if (op.type === "claim") {
      var it = findItem(room, op.itemId);
      if (!it) return { ok: false, error: "item_not_found", op: i };
      if (it.owner && it.owner !== memberId && !op.force) {
        return { ok: false, error: "already_claimed", op: i, owner: it.owner };
      }
      plan.push({ kind: "claim", item: it, owner: op.unclaim ? null : memberId });
    } else if (op.type === "toggle") {
      var it2 = findItem(room, op.itemId);
      if (!it2) return { ok: false, error: "item_not_found", op: i };
      plan.push({ kind: "toggle", item: it2, done: !!op.done });
    } else if (op.type === "addItem") {
      if (op.base !== room.version) {
        return { ok: false, error: "stale", op: i, version: room.version };
      }
      var itemName = String(op.name || "").trim().slice(0, 40);
      if (!itemName) return { ok: false, error: "need_item_name", op: i };
      var itemCat = normalizeCat(op.cat);
      if (CAT_KEYS["其他"] === itemCat) itemCat = "misc";
      plan.push({
        kind: "addItem",
        item: {
          id: id("i"),
          name: itemName,
          cat: itemCat,
          qty: Math.max(1, Math.min(99, Number(op.qty) || 1)),
          owner: memberId,
          done: false,
        },
      });
    } else if (op.type === "removeItem") {
      var it3 = findItem(room, op.itemId);
      if (!it3) return { ok: false, error: "item_not_found", op: i };
      if (op.base !== room.version) {
        return { ok: false, error: "stale", op: i, version: room.version };
      }
      plan.push({ kind: "removeItem", item: it3 });
    } else if (op.type === "renameTrip") {
      if (op.base !== room.version) {
        return { ok: false, error: "stale", op: i, version: room.version };
      }
      plan.push({ kind: "renameTrip", tripName: String(op.tripName || "").slice(0, 40) });
    } else {
      return { ok: false, error: "unknown_op", op: i };
    }
  }

  for (var k = 0; k < plan.length; k++) {
    var p = plan[k];
    if (p.kind === "claim") p.item.owner = p.owner;
    else if (p.kind === "toggle") p.item.done = p.done;
    else if (p.kind === "addItem") room.items.push(p.item);
    else if (p.kind === "removeItem") {
      room.items = room.items.filter(function (x) { return x.id !== p.item.id; });
    } else if (p.kind === "renameTrip") room.tripName = p.tripName;
  }
  return { ok: true };
}

function readBody(req) {
  return new Promise(function (resolve, reject) {
    var chunks = [];
    var size = 0;
    req.on("data", function (c) {
      size += c.length;
      if (size > 256 * 1024) { reject(new Error("body too large")); req.destroy(); return; }
      chunks.push(c);
    });
    req.on("end", function () {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
      catch (e) { reject(new Error("bad json")); }
    });
    req.on("error", reject);
  });
}

function send(res, status, obj) {
  var body = JSON.stringify(obj);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    // 开发期本地跨端口调试用；正式走 CloudBase SDK，不需要
    "Access-Control-Allow-Origin": "*",
  });
  res.end(body);
}

function serveStatic(req, res, pathname) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  var relative;
  try {
    relative = decodeURIComponent(pathname || "/");
  } catch (e) {
    return false;
  }
  if (relative === "/") relative = "/index.html";
  relative = relative.replace(/^\/+/, "");
  var mime = PUBLIC_FILES[relative];
  if (!mime && /^icons\/[a-z0-9-]+\.png$/.test(relative)) mime = "image/png";
  if (!mime || relative.indexOf("..") >= 0) return false;
  var full = path.join(__dirname, relative);
  try {
    var body = fs.readFileSync(full);
    res.writeHead(200, {
      "Content-Type": mime,
      "Cache-Control": relative === "index.html" ? "no-store" : "no-cache",
      "Access-Control-Allow-Origin": "*",
    });
    if (req.method === "HEAD") res.end();
    else res.end(body);
    return true;
  } catch (e) {
    return false;
  }
}

const server = http.createServer(function (req, res) {
  var u = new URL(req.url, "http://localhost");
  var route = req.method + " " + u.pathname;

  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  Promise.resolve()
    .then(function () {
      if (route === "GET /api/health") {
        return send(res, 200, { ok: true, rooms: fs.readdirSync(DATA_DIR).length });
      }

      if (route === "POST /api/create") {
        return readBody(req).then(function (b) {
          var nickname = String(b.nickname || "").trim().slice(0, 16);
          if (!nickname) return send(res, 400, { ok: false, error: "need_nickname" });
          var mid = id("m");
          var token = crypto.randomBytes(24).toString("hex");
          var room = {
            code: newCode(),
            teamName: String(b.teamName || "我们的出行清单").trim().slice(0, 20),
            tripName: String(b.tripName || "出行清单").trim().slice(0, 40),
            scene: SCENE_KEYS[b.scene] ? b.scene : "business",
            days: normalizeDays(b.days),
            version: 1,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            members: [{ id: mid, token: token, nickname: nickname, joinedAt: Date.now(), isCreator: true }],
            items: (Array.isArray(b.items) ? b.items : []).slice(0, 200).map(function (x) {
              return {
                id: id("i"),
                name: String(x.name || "").trim().slice(0, 40),
                cat: normalizeCat(x.cat),
                qty: Math.max(1, Math.min(99, Number(x.qty) || 1)),
                owner: null,
                done: false,
              };
            }).filter(function (x) { return !!x.name; }),
          };
          saveRoom(room);
          return send(res, 200, { ok: true, memberId: mid, memberToken: token, room: publicView(room) });
        });
      }

      if (route === "POST /api/join") {
        return readBody(req).then(function (b) {
          var code = String(b.code || "").trim().toUpperCase();
          var room = loadRoom(code);
          if (!room) return send(res, 404, { ok: false, error: "room_not_found" });
          var nickname = String(b.nickname || "").trim().slice(0, 16);
          if (!nickname) return send(res, 400, { ok: false, error: "need_nickname" });
          if (room.members.length >= 10) return send(res, 409, { ok: false, error: "room_full" });
          var mid = id("m");
          var token = crypto.randomBytes(24).toString("hex");
          room.members.push({ id: mid, token: token, nickname: nickname, joinedAt: Date.now(), isCreator: false });
          bump(room);
          return send(res, 200, { ok: true, memberId: mid, memberToken: token, room: publicView(room) });
        });
      }

      if (route === "GET /api/room") {
        var code2 = String(u.searchParams.get("code") || "").toUpperCase();
        var since = Number(u.searchParams.get("since") || 0);
        var room2 = loadRoom(code2);
        if (!room2) return send(res, 404, { ok: false, error: "room_not_found" });
        // 版本未变则回 304 语义，省流量：轮询大多数时候命中这里
        if (since === room2.version) {
          return send(res, 200, { ok: true, changed: false, version: room2.version });
        }
        return send(res, 200, { ok: true, changed: true, room: publicView(room2) });
      }

      if (route === "POST /api/ops") {
        return readBody(req).then(function (b) {
          var room3 = loadRoom(String(b.code || "").toUpperCase());
          if (!room3) return send(res, 404, { ok: false, error: "room_not_found" });
          if (!findMember(room3, String(b.memberId || ""), b.memberToken)) {
            return send(res, 403, { ok: false, error: "not_member" });
          }
          var ops = Array.isArray(b.ops) ? b.ops : [];
          if (!ops.length) return send(res, 200, { ok: true, version: room3.version });
          var r = applyOps(room3, b.memberId, ops);
          if (!r.ok) return send(res, 409, { ok: false, error: r.error, op: r.op, version: room3.version, owner: r.owner });
          bump(room3);
          return send(res, 200, { ok: true, version: room3.version, room: publicView(room3) });
        });
      }

      if (serveStatic(req, res, u.pathname)) return;
      return send(res, 404, { ok: false, error: "no_route", route: route });
    })
    .catch(function (e) {
      send(res, 500, { ok: false, error: String(e.message || e) });
    });
});

server.listen(PORT, "0.0.0.0", function () {
  console.log("travel list + team server on http://0.0.0.0:" + PORT + "  data=" + DATA_DIR);
});
