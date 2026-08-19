
"use strict";

const fs = require("fs");
const path = require("path");
const http = require("http");
const WebSocket = require("ws");

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "accounts.json");
fs.mkdirSync(DATA_DIR, {recursive:true});

const WORLD = {w:3200,h:2400};
const MAX_SPEED = 330;
const TICK_MS = 100;
const PROTOCOL = "4.11.1";

function loadDB(){
  try { return JSON.parse(fs.readFileSync(DB_FILE,"utf8")); }
  catch {
    return {
      demo:{
        password:"demo",
        character:{
          name:"Thiếu Hiệp",level:14,className:"Võ Đang",element:"Kim",
          x:1600,y:1500,hp:180,maxHp:220,mp:33,maxMp:60,gold:733,
          inventory:[]
        }
      }
    };
  }
}
let db = loadDB();

function saveDB(){
  fs.writeFileSync(DB_FILE, JSON.stringify(db,null,2));
}

function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
function safeNumber(v, fallback=0){
  return Number.isFinite(Number(v)) ? Number(v) : fallback;
}

const server = http.createServer((req,res)=>{
  if(req.url==="/" || req.url==="/index.html"){
    res.writeHead(200,{"Content-Type":"text/html; charset=utf-8"});
    return res.end(fs.readFileSync(path.join(__dirname,"index.html")));
  }
  res.writeHead(404);
  res.end("Not found");
});

const wss = new WebSocket.Server({server});
const sessions = new Map();

wss.on("connection",(ws,req)=>{
  const playerId = "p_"+Math.random().toString(36).slice(2,10);
  const session = {
    id:playerId, ws,
    account:null,
    character:null,
    input:{x:0,y:0,mounted:false,cape:true},
    lastInput:0,
    lastSeq:0,
    rateViolations:0
  };
  sessions.set(playerId,session);

  ws.send(JSON.stringify({type:"hello_required"}));

  ws.on("message",(raw)=>{
    let msg;
    try { msg=JSON.parse(raw.toString()); }
    catch { return ws.send(JSON.stringify({type:"error",text:"Gói tin không hợp lệ"})); }

    if(msg.type==="hello"){
      const account=String(msg.account||"demo").slice(0,32);
      if(!db[account]){
        db[account]={
          password:"demo",
          character:{
            x:1600,y:1500,hp:180,mp:33,gold:733,inventory:[],name:"Thiếu Hiệp",level:14,className:"Võ Đang",element:"Kim",maxHp:220,maxMp:60
          }
        };
        saveDB();
      }
      session.account=account;
      session.character=db[account].character;
      session.character.name=session.character.name||"Thiếu Hiệp";
      session.character.level=session.character.level||14;
      session.character.className=session.character.className||"Võ Đang";
      session.character.element=session.character.element||"Kim";

      return ws.send(JSON.stringify({
        type:"welcome",
        protocol:PROTOCOL,
        playerId,
        player:{
          x:session.character.x,y:session.character.y,
          hp:session.character.hp,mp:session.character.mp,
          gold:session.character.gold
        }
      }));
    }

    if(msg.type==="input"){
      if(!session.character) return;
      const now=Date.now();

      // Rate limit: at most 20 input packets/sec.
      if(now-session.lastInput<35){
        session.rateViolations++;
        if(session.rateViolations>20){
          return ws.close(1008,"Too many inputs");
        }
        return;
      }
      session.lastInput=now;

      session.input.mounted=!!msg.mounted;
      session.input.cape=msg.cape!==false;
      let x=clamp(safeNumber(msg.x),-1,1);
      let y=clamp(safeNumber(msg.y),-1,1);
      const len=Math.hypot(x,y);
      if(len>1){x/=len;y/=len;}

      const dt=Math.min(0.15, Math.max(0.01,(now-(session._moveAt||now))/1000));
      session._moveAt=now;

      const speed=msg.mounted ? MAX_SPEED : 230;
      session.character.x=clamp(session.character.x+x*speed*dt,25,WORLD.w-25);
      session.character.y=clamp(session.character.y+y*speed*dt,25,WORLD.h-25);

      const seq=Number(msg.seq);
      if(Number.isFinite(seq) && seq>=session.lastSeq) session.lastSeq=seq;
    }

    // Example server-authoritative action endpoint.
    if(msg.type==="use_item"){
      // Never trust a client-side inventory mutation.
      ws.send(JSON.stringify({type:"error",text:"Hành động vật phẩm phải được server xác nhận."}));
    }
  });

  ws.on("error",()=>{});
  ws.on("pong",()=>{session.lastPong=Date.now()});

  ws.on("close",()=>{
    if(session.character && session.account){
      db[session.account].character=session.character;
      saveDB();
    }
    sessions.delete(playerId);
  });
});

setInterval(()=>{
  const players=[];
  for(const s of sessions.values()){
    if(!s.character) continue;
    players.push({
      id:s.id,
      x:s.character.x,y:s.character.y,
      name:s.character.name||"Thiếu Hiệp",
      level:s.character.level||14,
      className:s.character.className||"Võ Đang",
      element:s.character.element||"Kim",
      mounted:!!s.input.mounted,
      cape:!!s.input.cape,
      hp:s.character.hp, maxHp:s.character.maxHp||220
    });
  }

  for(const s of sessions.values()){
    if(s.ws.readyState!==WebSocket.OPEN || !s.character) continue;
    s.ws.send(JSON.stringify({
      type:"snapshot",
      protocol:PROTOCOL,
      serverTime:Date.now(),
      player:{
        x:s.character.x,y:s.character.y,
        hp:s.character.hp,mp:s.character.mp,
        gold:s.character.gold,
        mounted:!!s.input.mounted,
        cape:!!s.input.cape
      },
      players
    }));
  }
},TICK_MS);

setInterval(()=>{
  const now=Date.now();
  for(const s of sessions.values()){
    if(s.ws.readyState!==WebSocket.OPEN) continue;
    if(s.lastPong && now-s.lastPong>30000){ try{s.ws.terminate()}catch(_){} continue; }
    s.lastPong=now;
    try{s.ws.ping()}catch(_){}
  }
},15000);

server.listen(PORT,()=>console.log(`Kiếm Thế 4.11.1 server: http://localhost:${PORT}`));
