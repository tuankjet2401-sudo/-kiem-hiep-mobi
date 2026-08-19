"use strict";

const fs = require("fs");

const path = require("path");

const http = require("http");

const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);

const DATA_DIR = path.join(__dirname, "data");

const DB_FILE = path.join(DATA_DIR, "accounts.json");

fs.mkdirSync(DATA_DIR, { recursive: true });

/* =========================

   KIẾM THẾ MOBI 4.11.2

   SERVER

========================= */

const WORLD = {

  w: 3200,

  h: 2400

};

const PROTOCOL = "4.11.2";

const PLAYER_RADIUS = 25;

const WALK_SPEED = 230;

const MOUNT_SPEED = 330;

const TICK_MS = 100;

const MAX_INPUT_RATE = 35;

const MAX_SESSIONS = 100;

/* =========================

   DATABASE

========================= */

function defaultCharacter() {

  return {

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

    mounted: false,

    cape: true,

    inventory: [],

    weapon: null,

    armor: null

  };

}

function loadDB() {

  try {

    const raw = fs.readFileSync(DB_FILE, "utf8");

    const data = JSON.parse(raw);

    if (data && typeof data === "object") {

      return data;

    }

  } catch (_) {}

  const db = {

    demo: {

      password: "demo",

      character: defaultCharacter()

    }

  };

  fs.writeFileSync(

    DB_FILE,

    JSON.stringify(db, null, 2)

  );

  return db;

}

let db = loadDB();

function saveDB() {

  try {

    fs.writeFileSync(

      DB_FILE,

      JSON.stringify(db, null, 2)

    );

  } catch (err) {

    console.error(

      "Không thể lưu database:",

      err.message

    );

  }

}

/* =========================

   UTILITY

========================= */

function clamp(v, a, b) {

  return Math.max(

    a,

    Math.min(b, v)

  );

}

function safeNumber(v, fallback = 0) {

  const n = Number(v);

  return Number.isFinite(n)

    ? n

    : fallback;

}

function cleanText(v, max = 80) {

  return String(v || "")

    .replace(/[<>]/g, "")

    .slice(0, max);

}

function normalizeCharacter(c) {

  const d = defaultCharacter();

  if (!c || typeof c !== "object") {

    return d;

  }

  c.name =

    cleanText(c.name || d.name, 24);

  c.level =

    clamp(

      Math.floor(

        safeNumber(c.level, d.level)

      ),

      1,

      200

    );

  c.className =

    cleanText(

      c.className || d.className,

      30

    );

  c.element =

    cleanText(

      c.element || d.element,

      12

    );

  c.x =

    clamp(

      safeNumber(c.x, d.x),

      PLAYER_RADIUS,

      WORLD.w - PLAYER_RADIUS

    );

  c.y =

    clamp(

      safeNumber(c.y, d.y),

      PLAYER_RADIUS,

      WORLD.h - PLAYER_RADIUS

    );

  c.maxHp =

    Math.max(

      1,

      safeNumber(c.maxHp, d.maxHp)

    );

  c.maxMp =

    Math.max(

      1,

      safeNumber(c.maxMp, d.maxMp)

    );

  c.hp =

    clamp(

      safeNumber(c.hp, d.hp),

      0,

      c.maxHp

    );

  c.mp =

    clamp(

      safeNumber(c.mp, d.mp),

      0,

      c.maxMp

    );

  c.gold =

    Math.max(

      0,

      Math.floor(

        safeNumber(c.gold, d.gold)

      )

    );

  c.mounted = !!c.mounted;

  c.cape = c.cape !== false;

  if (!Array.isArray(c.inventory)) {

    c.inventory = [];

  }

  if (c.inventory.length > 24) {

    c.inventory.length = 24;

  }

  return c;

}

/* =========================

   HTTP SERVER

========================= */

const server = http.createServer(

  (req, res) => {

    if (

      req.url === "/" ||

      req.url === "/index.html"

    ) {

      const file =

        path.join(

          __dirname,

          "index.html"

        );

      try {

        res.writeHead(

          200,

          {

            "Content-Type":

              "text/html; charset=utf-8",

            "Cache-Control":

              "no-store"

          }

        );

        return res.end(

          fs.readFileSync(file)

        );

      } catch (err) {

        res.writeHead(500);

        return res.end(

          "Không tìm thấy index.html"

        );

      }

    }

    res.writeHead(404);

    res.end("Not found");

  }

);

/* =========================

   WEBSOCKET

========================= */

const wss =

  new WebSocket.Server({

    server,

    maxPayload: 32 * 1024

  });

const sessions = new Map();

function broadcast(message) {

  const data =

    JSON.stringify(message);

  for (

    const session of sessions.values()

  ) {

    if (

      session.ws.readyState ===

      WebSocket.OPEN

    ) {

      try {

        session.ws.send(data);

      } catch (_) {}

    }

  }

}

/* =========================

   PLAYER SNAPSHOT

========================= */

function publicPlayer(session) {

  const c = session.character;

  if (!c) return null;

  return {

    id: session.id,

    x: c.x,

    y: c.y,

    name: c.name,

    level: c.level,

    className: c.className,

    element: c.element,

    hp: c.hp,

    maxHp: c.maxHp,

    mounted:

      !!session.input.mounted,

    cape:

      !!session.input.cape

  };

}

function serverPlayer(session) {

  const c = session.character;

  return {

    x: c.x,

    y: c.y,

    hp: c.hp,

    maxHp: c.maxHp,

    mp: c.mp,

    maxMp: c.maxMp,

    gold: c.gold,

    mounted:

      !!session.input.mounted,

    cape:

      !!session.input.cape

  };

}

/* =========================

   CONNECTION

========================= */

wss.on(

  "connection",

  (ws) => {

    if (

      sessions.size >= MAX_SESSIONS

    ) {

      ws.close(

        1013,

        "Server đầy"

      );

      return;

    }

    const playerId =

      "p_" +

      Math.random()

        .toString(36)

        .slice(2, 10);

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

      moveAt: Date.now(),

      lastPong: Date.now(),

      authenticated: false

    };

    sessions.set(

      playerId,

      session

    );

    ws.send(

      JSON.stringify({

        type: "hello_required",

        protocol: PROTOCOL

      })

    );

    /* =========================

       MESSAGE

    ========================= */

    ws.on(

      "message",

      (raw) => {

        let msg;

        try {

          msg =

            JSON.parse(

              raw.toString()

            );

        } catch (_) {

          ws.send(

            JSON.stringify({

              type: "error",

              text:

                "Gói tin không hợp lệ"

            })

          );

          return;

        }

        if (

          !msg ||

          typeof msg !== "object"

        ) {

          return;

        }

        /* =========================

           HELLO / LOGIN DEMO

        ========================= */

        if (

          msg.type === "hello"

        ) {

          const account =

            cleanText(

              msg.account || "demo",

              32

            );

          if (!db[account]) {

            db[account] = {

              password: "demo",

              character:

                defaultCharacter()

            };

            saveDB();

          }

          session.account =

            account;

          session.character =

            normalizeCharacter(

              db[account].character

            );

          db[account].character =

            session.character;

          session.authenticated =

            true;

          ws.send(

            JSON.stringify({

              type: "welcome",

              protocol: PROTOCOL,

              playerId,

              player:

                serverPlayer(session)

            })

          );

          return;

        }

        /* =========================

           TẤT CẢ ACTION CẦN LOGIN

        ========================= */

        if (

          !session.authenticated ||

          !session.character

        ) {

          ws.send(

            JSON.stringify({

              type: "error",

              text:

                "Chưa đăng nhập nhân vật"

            })

          );

          return;

        }

        /* =========================

           INPUT DI CHUYỂN

        ========================= */

        if (

          msg.type === "input"

        ) {

          const now =

            Date.now();

          if (

            now -

            session.lastInput

            <

            MAX_INPUT_RATE

          ) {

            session.rateViolations++;

            if (

              session.rateViolations >

              25

            ) {

              ws.close(

                1008,

                "Too many inputs"

              );

              return;

            }

            return;

          }

          session.lastInput =

            now;

          session.input.mounted =

            !!msg.mounted;

          session.input.cape =

            msg.cape !== false;

          let x =

            clamp(

              safeNumber(

                msg.x

              ),

              -1,

              1

            );

          let y =

            clamp(

              safeNumber(

                msg.y

              ),

              -1,

              1

            );

          const len =

            Math.hypot(

              x,

              y

            );

          if (len > 1) {

            x /= len;

            y /= len;

          }

          const nowMove =

            Date.now();

          const dt =

            Math.min(

              0.15,

              Math.max(

                0.01,

                (

                  nowMove -

                  session.moveAt

                ) / 1000

              )

            );

          session.moveAt =

            nowMove;

          const speed =

            session.input.mounted

              ? MOUNT_SPEED

              : WALK_SPEED;

          /*

             SERVER TỰ TÍNH VỊ TRÍ.

             Client không được gửi x/y thật.

          */

          session.character.x =

            clamp(

              session.character.x +

                x *

                speed *

                dt,

              PLAYER_RADIUS,

              WORLD.w -

                PLAYER_RADIUS

            );

          session.character.y =

            clamp(

              session.character.y +

                y *

                speed *

                dt,

              PLAYER_RADIUS,

              WORLD.h -

                PLAYER_RADIUS

            );

          const seq =

            Number(msg.seq);

          if (

            Number.isFinite(seq) &&

            seq >= session.lastSeq

          ) {

            session.lastSeq =

              seq;

          }

          return;

        }

        /* =========================

           DÙNG VẬT PHẨM

        ========================= */

        if (

          msg.type === "use_item"

        ) {

          ws.send(

            JSON.stringify({

              type: "error",

              text:

                "Hành động vật phẩm phải được server xác nhận."

            })

          );

          return;

        }

        /* =========================

           CHAT

        ========================= */

        if (

          msg.type === "world_chat"

        ) {

          const text =

            cleanText(

              msg.text,

              80

            );

          if (!text) {

            return;

          }

          broadcast({

            type: "world_chat",

            playerId,

            name:

              session.character.name,

            text

          });

          return;

        }

        /* =========================

           PING

        ========================= */

        if (

          msg.type === "ping"

        ) {

          ws.send(

            JSON.stringify({

              type: "pong",

              serverTime:

                Date.now()

            })

          );

        }

      }

    );

    /* =========================

       ERROR

    ========================= */

    ws.on(

      "error",

      () => {}

    );

    /* =========================

       PONG

    ========================= */

    ws.on(

      "pong",

      () => {

        session.lastPong =

          Date.now();

      }

    );

    /* =========================

       CLOSE

    ========================= */

    ws.on(

      "close",

      () => {

        if (

          session.character &&

          session.account &&

          db[session.account]

        ) {

          session.character =

            normalizeCharacter(

              session.character

            );

          db[session.account].character =

            session.character;

          saveDB();

        }

        sessions.delete(

          playerId

        );

      }

    );

  }

);

/* =========================

   WORLD TICK

========================= */

setInterval(

  () => {

    const players = [];

    for (

      const session

      of sessions.values()

    ) {

      if (

        !session.character ||

        !session.authenticated

      ) {

        continue;

      }

      players.push(

        publicPlayer(session)

      );

    }

    for (

      const session

      of sessions.values()

    ) {

      if (

        session.ws.readyState !==

        WebSocket.OPEN

      ) {

        continue;

      }

      if (

        !session.character

      ) {

        continue;

      }

      try {

        session.ws.send(

          JSON.stringify({

            type: "snapshot",

            protocol: PROTOCOL,

            serverTime:

              Date.now(),

            player:

              serverPlayer(

                session

              ),

            players

          })

        );

      } catch (_) {}

    }

  },

  TICK_MS

);

/* =========================

   HEARTBEAT

========================= */

setInterval(

  () => {

    const now =

      Date.now();

    for (

      const session

      of sessions.values()

    ) {

      if (

        session.ws.readyState !==

        WebSocket.OPEN

      ) {

        continue;

      }

      if (

        now -

        session.lastPong

        >

        30000

      ) {

        try {

          session.ws.terminate();

        } catch (_) {}

        continue;

      }

      session.lastPong =

        now;

      try {

        session.ws.ping();

      } catch (_) {}

    }

  },

  15000

);

/* =========================

   AUTO SAVE

========================= */

setInterval(

  () => {

    for (

      const session

      of sessions.values()

    ) {

      if (

        !session.character ||

        !session.account

      ) {

        continue;

      }

      if (!db[session.account]) {

        continue;

      }

      db[session.account].character =

        session.character;

    }

    saveDB();

  },

  10000

);

/* =========================

   SERVER START

========================= */

server.listen(

  PORT,

  () => {

    console.log(

      `Kiếm Thế Mobi 4.11.2 Server đang chạy tại http://localhost:${PORT}`

    );

    console.log(

      `Protocol: ${PROTOCOL}`

    );

  }

);
