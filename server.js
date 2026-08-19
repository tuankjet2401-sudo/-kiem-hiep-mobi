"use strict";

const fs = require("fs");

const path = require("path");

const http = require("http");

const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "accounts.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

const WORLD = { w: 3200, h: 2400 };

const MAX_SPEED = 330;

const PROTOCOL = "4.11.2";

function loadDB() {

  try {

    return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));

  } catch {

    return {

      demo: {

        password: "demo",

        character: {

          name: "Thiếu Hiệp",

          level: 14,

          className: "Võ Đang",

          element: "Kim",

          x: 1600,

          y: 1500,

          hp: 180,

          maxHp: 220,

          mp: 33,

          maxMp: 60,

          gold: 733,

          inventory: []

        }

      }

    };

  }

}

let db = loadDB();

function saveDB() {

  try {

    fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));

  } catch (e) {

    console.error("DB save error:", e.message);

  }

}

function clamp(v, a, b) {

  return Math.max(a, Math.min(b, v));

}

function safeNumber(v, fallback = 0) {

  return Number.isFinite(Number(v)) ? Number(v) : fallback;

}

function sendJSON(res, code, data) {

  res.writeHead(code, {

    "Content-Type": "application/json; charset=utf-8",

    "Cache-Control": "no-store"

  });

  res.end(JSON.stringify(data));

}

const server = http.createServer((req, res) => {

  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Health check

  if (url.pathname === "/health") {

    return sendJSON(res, 200, {

      ok: true,

      game: "Kiem Hiep Mobi",

      protocol: PROTOCOL,

      time: Date.now()

    });

  }

  // Game client

  if (

    url.pathname === "/" ||

    url.pathname === "/index.html"

  ) {

    const indexFile = path.join(__dirname, "index.html");

    if (!fs.existsSync(indexFile)) {

      return sendJSON(res, 500, {

        ok: false,

        error: "index.html not found"

      });

    }

    res.writeHead(200, {

      "Content-Type": "text/html; charset=utf-8",

      "Cache-Control": "no-store"

    });

    return fs.createReadStream(indexFile).pipe(res);

  }

  res.writeHead(404, {

    "Content-Type": "text/plain; charset=utf-8"

  });

  res.end("Not found");

});

const wss = new WebSocket.Server({ server });

const sessions = new Map();

wss.on("connection", (ws) => {

  const playerId =

    "p_" + Math.random().toString(36).slice(2, 10);

  const session = {

    id: playerId,

    ws,

    account: null,

    character: null,

    input: {

      x: 0,

      y: 0,

      mounted: false,

      cape: true

    },

    lastInput: 0,

    lastSeq: 0,

    rateViolations: 0,

    _moveAt: Date.now(),

    lastPong: Date.now()

  };

  sessions.set(playerId, session);

  ws.send(JSON.stringify({

    type: "hello_required",

    protocol: PROTOCOL

  }));

  ws.on("message", (raw) => {

    let msg;

    try {

      msg = JSON.parse(raw.toString());

    } catch {

      return ws.send(JSON.stringify({

        type: "error",

        text: "Gói tin không hợp lệ"

      }));

    }

    // LOGIN / HELLO

    if (msg.type === "hello") {

      const account =

        String(msg.account || "demo").slice(0, 32);

      if (!db[account]) {

        db[account] = {

          password: "demo",

          character: {

            x: 1600,

            y: 1500,

            hp: 180,

            maxHp: 220,

            mp: 33,

            maxMp: 60,

            gold: 733,

            inventory: [],

            name: "Thiếu Hiệp",

            level: 14,

            className: "Võ Đang",

            element: "Kim"

          }

        };

        saveDB();

      }

      session.account = account;

      session.character = db[account].character;

      const ch = session.character;

      ch.name = ch.name || "Thiếu Hiệp";

      ch.level = ch.level || 14;

      ch.className = ch.className || "Võ Đang";

      ch.element = ch.element || "Kim";

      ch.maxHp = ch.maxHp || 220;

      ch.maxMp = ch.maxMp || 60;

      ch.x = safeNumber(ch.x, 1600);

      ch.y = safeNumber(ch.y, 1500);

      return ws.send(JSON.stringify({

        type: "welcome",

        protocol: PROTOCOL,

        playerId,

        player: {

          x: ch.x,

          y: ch.y,

          hp: ch.hp,

          mp: ch.mp,

          gold: ch.gold,

          name: ch.name,

          level: ch.level,

          className: ch.className,

          element: ch.element

        }

      }));

    }

    // MOVEMENT

    if (msg.type === "input") {

      if (!session.character) return;

      const now = Date.now();

      if (now - session.lastInput < 35) {

        session.rateViolations++;

        if (session.rateViolations > 20) {

          return ws.close(1008, "Too many inputs");

        }

        return;

      }

      session.lastInput = now;

      let x = clamp(safeNumber(msg.x), -1, 1);

      let y = clamp(safeNumber(msg.y), -1, 1);

      const len = Math.hypot(x, y);

      if (len > 1) {

        x /= len;

        y /= len;

      }

      session.input.x = x;

      session.input.y = y;

      session.input.mounted = !!msg.mounted;

      session.input.cape = msg.cape !== false;

      const dt = Math.min(

        0.15,

        Math.max(

          0.01,

          (now - session._moveAt) / 1000

        )

      );

      session._moveAt = now;

      const speed =

        session.input.mounted

          ? MAX_SPEED

          : 230;

      session.character.x = clamp(

        session.character.x + x * speed * dt,

        25,

        WORLD.w - 25

      );

      session.character.y = clamp(

        session.character.y + y * speed * dt,

        25,

        WORLD.h - 25

      );

      const seq = Number(msg.seq);

      if (

        Number.isFinite(seq) &&

        seq >= session.lastSeq

      ) {

        session.lastSeq = seq;

      }

      return;

    }

    // ITEM

    if (msg.type === "use_item") {

      return ws.send(JSON.stringify({

        type: "error",

        text: "Hành động vật phẩm phải được server xác nhận."

      }));

    }

  });

  ws.on("pong", () => {

    session.lastPong = Date.now();

  });

  ws.on("error", () => {});

  ws.on("close", () => {

    if (session.character && session.account) {

      db[session.account].character =

        session.character;

      saveDB();

    }

    sessions.delete(playerId);

  });

});

// SNAPSHOT

setInterval(() => {

  const players = [];

  for (const s of sessions.values()) {

    if (!s.character) continue;

    const ch = s.character;

    players.push({

      id: s.id,

      x: ch.x,

      y: ch.y,

      name: ch.name || "Thiếu Hiệp",

      level: ch.level || 14,

      className: ch.className || "Võ Đang",

      element: ch.element || "Kim",

      mounted: !!s.input.mounted,

      cape: !!s.input.cape,

      hp: ch.hp,

      maxHp: ch.maxHp || 220

    });

  }

  for (const s of sessions.values()) {

    if (

      s.ws.readyState !== WebSocket.OPEN ||

      !s.character

    ) {

      continue;

    }

    const ch = s.character;

    s.ws.send(JSON.stringify({

      type: "snapshot",

      protocol: PROTOCOL,

      serverTime: Date.now(),

      player: {

        x: ch.x,

        y: ch.y,

        hp: ch.hp,

        mp: ch.mp,

        gold: ch.gold,

        mounted: !!s.input.mounted,

        cape: !!s.input.cape

      },

      players

    }));

  }

}, 100);

// PING

setInterval(() => {

  const now = Date.now();

  for (const s of sessions.values()) {

    if (s.ws.readyState !== WebSocket.OPEN) {

      continue;

    }

    if (

      s.lastPong &&

      now - s.lastPong > 30000

    ) {

      try {

        s.ws.terminate();

      } catch (_) {}

      continue;

    }

    try {

      s.ws.ping();

    } catch (_) {}

  }

}, 15000);

server.listen(PORT, "0.0.0.0", () => {

  console.log(

    `Kiếm Thế Mobi ${PROTOCOL} server listening on port ${PORT}`

  );

});
