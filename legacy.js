'use strict';
const {randomUUID} = require('node:crypto');
// Protocolo do v7: somente salas temporárias públicas, separado das contas v9.
module.exports = function legacy(wss, iceServers) {
  const rooms = new Map();
  const send = (ws, data) => {if (ws.readyState === 1) ws.send(JSON.stringify(data));};
  const broadcast = (room, except, data) => {for (const p of rooms.get(room)?.values() || []) if (p.ws !== except) send(p.ws, data);};
  const remove = ws => {
    const room = rooms.get(ws.room);
    if (!room) return;
    room.delete(ws.id);
    broadcast(ws.room, ws, {type: 'peer-left', id: ws.id});
    if (!room.size) rooms.delete(ws.room);
    ws.room = null;
  };
  wss.on('connection', ws => {
    ws.id = randomUUID(); ws.alive = true;
    ws.on('pong', () => {ws.alive = true;});
    let count = 0, since = Date.now();
    ws.on('message', raw => {
      if (Date.now() - since > 10000) {count = 0; since = Date.now();}
      if (++count > 200) return ws.close(1008, 'Rate limit');
      let m; try {m = JSON.parse(raw);} catch {return;}
      if (!m || typeof m !== 'object') return;
      if (m.type === 'join') {
        const room = String(m.room || '').trim().toUpperCase().replace(/[^A-Z0-9-]/g, '').slice(0, 32);
        if (!room) return send(ws, {type: 'error', message: 'Código inválido.'});
        if (rooms.get(room)?.size >= 6) return send(ws, {type: 'error', message: 'Sala cheia (6 pessoas).'});
        if (!rooms.has(room) && rooms.size >= 200) return send(ws, {type: 'error', message: 'Limite de salas atingido.'});
        remove(ws);
        if (!rooms.has(room)) rooms.set(room, new Map());
        ws.room = room;
        const peer = {ws, id: ws.id, name: String(m.name || 'Convidado').slice(0, 24), sharing: false};
        rooms.get(room).set(ws.id, peer);
        const peers = [...rooms.get(room).values()].map(({id, name, sharing}) => ({id, name, sharing}));
        send(ws, {type: 'joined', id: ws.id, room, maxPeers: 6, peers, iceServers});
        broadcast(room, ws, {type: 'peer-joined', peer: {id: ws.id, name: peer.name, sharing: false}});
      } else if (ws.room && m.type === 'share-state') {
        rooms.get(ws.room)?.get(ws.id) && (rooms.get(ws.room).get(ws.id).sharing = !!m.sharing);
        broadcast(ws.room, ws, {type: 'share-state', id: ws.id, sharing: !!m.sharing});
      } else if (ws.room && ['offer', 'answer', 'ice'].includes(m.type)) {
        const target = rooms.get(ws.room)?.get(m.to);
        if (target) send(target.ws, {type: m.type, from: ws.id, offer: m.offer, answer: m.answer, candidate: m.candidate});
      }
    });
    ws.on('close', () => remove(ws));
    ws.on('error', () => remove(ws));
  });
  return rooms;
};
