'use strict';
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const {promisify} = require('node:util');
const {WebSocketServer} = require('ws');
const {createStore, validateState} = require('./store');
const scrypt = promisify(crypto.scrypt);
const uuid = () => crypto.randomUUID();
const hashToken = s => crypto.createHash('sha256').update(s).digest('hex');
const publicUser = u => ({id: u.id, username: u.username, name: u.name, bio: u.bio || '', admin: !!u.admin});
const fail = (status, message) => {const e = new Error(message); e.status = status; throw e;};
const text = (value, max, label) => {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) fail(400, `${label}: informe de 1 a ${max} caracteres.`);
  return value.trim();
};
const tokenFrom = req => /(?:^|;\s*)sr_session=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
const sameOrigin = req => !req.headers.origin || req.headers.origin === `${req.protocol}://${req.get('host')}`;

async function createApplication(options = {}) {
  const store = await createStore(options);
  const app = express(), server = http.createServer(app);
  const realtime = new WebSocketServer({noServer: true, maxPayload: 65536});
  const legacyWss = new WebSocketServer({noServer: true, maxPayload: 65536});
  let iceServers = [{urls: 'stun:stun.l.google.com:19302'}, {urls: 'stun:stun.cloudflare.com:3478'}];
  if (process.env.ICE_SERVERS_JSON) {
    iceServers = JSON.parse(process.env.ICE_SERVERS_JSON);
    if (!Array.isArray(iceServers) || !iceServers.length || iceServers.some(s => !s.urls)) throw new Error('ICE_SERVERS_JSON inválido.');
  }
  const legacyRooms = require('./legacy')(legacyWss, iceServers);
  const sockets = new Set(), calls = new Map(), limits = new Map();
  const maxPeers = Math.max(2, Math.min(12, Number(process.env.MAX_CALL_PEERS) || 6));
  const state = () => store.state;
  const sessionFor = req => {
    const token = tokenFrom(req);
    if (!token) return null;
    return state().sessions.find(s => s.hash === hashToken(token) && s.expires > Date.now());
  };
  const userFor = req => {const session = sessionFor(req); return session && state().users.find(u => u.id === session.userId);};
  const member = (community, user) => community?.members[user.id];
  const communityFor = (id, user) => {
    const c = state().communities.find(c => c.id === id);
    if (!member(c, user)) fail(404, 'Comunidade não encontrada.');
    return c;
  };
  const canModerate = (c, user) => ['owner', 'moderator'].includes(member(c, user));
  const conversation = (id, user) => {
    const c = state().channels.find(c => c.id === id);
    if (c) {communityFor(c.communityId, user); return c;}
    const d = state().dms.find(d => d.id === id && d.members.includes(user.id));
    if (d) return {...d, kind: 'dm'};
    fail(404, 'Canal não encontrado.');
  };
  const allowed = (id, userId) => {
    const u = state().users.find(u => u.id === userId);
    try {return !!u && !!conversation(id, u);} catch {return false;}
  };
  const send = (ws, m) => {
    if (ws.readyState !== 1) return;
    if (ws.bufferedAmount > 1024 * 1024) return ws.close(1013, 'Slow connection');
    ws.send(JSON.stringify(m));
  };
  const broadcast = (m, predicate = () => true) => {for (const ws of sockets) if (predicate(ws)) send(ws, m);};
  const refresh = () => {
    for (const ws of sockets) {
      if (!state().users.some(u => u.id === ws.userId) || !state().sessions.some(s => s.hash === ws.sessionHash && s.expires > Date.now())) {ws.close(1008, 'Session ended'); continue;}
      if (ws.call && !allowed(ws.call, ws.userId)) {leaveCall(ws); send(ws, {type: 'call-ended', message: 'Seu acesso à chamada foi removido.'});}
      send(ws, {type: 'refresh'});
    }
  };
  const viewMessage = m => ({...m, author: publicUser(state().users.find(u => u.id === m.authorId) || {id: m.authorId, username: 'removido', name: 'Usuário removido'})});
  const messageEvent = (type, m) => broadcast({type, message: viewMessage(m), channelId: m.channelId}, ws => allowed(m.channelId, ws.userId));
  const api = fn => async (req, res, next) => {try {await fn(req, res);} catch (e) {next(e);}};
  app.disable('x-powered-by');
  app.set('trust proxy', 1);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
    next();
  });
  app.get('/health', (_req, res) => res.json({ok: true, version: 9}));
  app.use('/api', (req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'HEAD'].includes(req.method) && !sameOrigin(req)) return res.status(403).json({error: 'Origem não permitida.'});
    const now = Date.now(), key = req.ip;
    const l = limits.get(key) || {at: now, n: 0};
    if (now - l.at > 60000) {l.at = now; l.n = 0;}
    limits.set(key, l);
    if (++l.n > 180) return res.status(429).json({error: 'Muitas solicitações. Aguarde um minuto.'});
    next();
  });
  app.use('/api/admin/restore', express.json({limit: '16mb'}));
  app.use(express.json({limit: '32kb'}));
  app.get('/api/config', (_req, res) => res.json({version: 9, storage: store.mode, maxPeers, features: ['chat', 'communities', 'dms', 'p2p', 'legacy-rooms']}));
  let activeAuth = 0;
  app.post(['/api/register', '/api/login'], api(async (req, res) => {
    if (activeAuth >= 4) fail(429, 'Muitos acessos simultâneos. Tente novamente.');
    const username = text(req.body.username, 24, 'Usuário').toLowerCase();
    if (!/^[a-z0-9_.-]{3,24}$/.test(username)) fail(400, 'Usuário: 3 a 24 letras, números, ponto, hífen ou sublinhado.');
    const password = req.body.password;
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail(400, 'Senha: de 8 a 128 caracteres.');
    const registering = req.path === '/api/register';
    const existing = state().users.find(u => u.username === username);
    const salt = registering ? crypto.randomBytes(16).toString('hex') : existing?.salt || '00000000000000000000000000000000';
    activeAuth++;
    let derived;
    try {derived = (await scrypt(password, salt, 64)).toString('hex');} finally {activeAuth--;}
    if (!registering && (!existing || !crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(existing.password, 'hex')))) fail(401, 'Usuário ou senha incorretos.');
    const token = crypto.randomBytes(32).toString('hex');
    let user;
    await store.change(s => {
      if (registering) {
        if (s.users.some(u => u.username === username)) fail(409, 'Esse nome de usuário já está em uso.');
        if (s.users.length >= 500) fail(409, 'Limite de 500 contas atingido.');
        user = {id: uuid(), username, name: text(req.body.name || username, 32, 'Nome'), salt, password: derived, bio: '', admin: s.users.length === 0};
        s.users.push(user);
      } else {user = s.users.find(u => u.id === existing.id); if (!user) fail(401, 'Entre novamente.');}
      s.sessions = s.sessions.filter(session => session.expires > Date.now());
      const own = s.sessions.filter(session => session.userId === user.id);
      if (own.length >= 8) s.sessions = s.sessions.filter(session => session.hash !== own[0].hash);
      s.sessions.push({hash: hashToken(token), userId: user.id, expires: Date.now() + 7 * 86400000});
    });
    res.cookie('sr_session', token, {httpOnly: true, secure: req.secure, sameSite: 'strict', path: '/', maxAge: 7 * 86400000});
    res.json({user: publicUser(user)});
  }));
  app.use('/api', (req, res, next) => {
    req.user = userFor(req);
    if (!req.user) return res.status(401).json({error: 'Entre na sua conta.'});
    next();
  });
  app.post('/api/logout', api(async (req, res) => {
    const hash = hashToken(tokenFrom(req));
    await store.change(s => {s.sessions = s.sessions.filter(t => t.hash !== hash);});
    for (const ws of sockets) if (ws.sessionHash === hash) ws.close(1008, 'Logout');
    res.clearCookie('sr_session', {path: '/'}).json({ok: true});
  }));
  app.get('/api/bootstrap', (req, res) => {
    const communities = state().communities.filter(c => member(c, req.user)).map(c => ({...c, members: Object.entries(c.members).map(([id, role]) => ({...publicUser(state().users.find(u => u.id === id)), role, online: [...sockets].some(ws => ws.userId === id)}))}));
    const dms = state().dms.filter(d => d.members.includes(req.user.id)).map(d => ({...d, users: d.members.map(id => publicUser(state().users.find(u => u.id === id)))}));
    res.json({user: publicUser(req.user), communities, channels: state().channels.filter(c => communities.some(g => g.id === c.communityId)), dms, iceServers, storage: store.mode, maxPeers});
  });
  app.patch('/api/profile', api(async (req, res) => {
    await store.change(s => {const u = s.users.find(u => u.id === req.user.id); u.name = text(req.body.name, 32, 'Nome'); u.bio = String(req.body.bio || '').slice(0, 160);});
    refresh(); res.json({ok: true});
  }));
  app.post('/api/communities', api(async (req, res) => {
    let result;
    await store.change(s => {
      if (s.communities.length >= 100 || s.communities.filter(c => c.owner === req.user.id).length >= 10) fail(409, 'Limite de comunidades atingido.');
      result = {id: uuid(), name: text(req.body.name, 48, 'Comunidade'), owner: req.user.id, members: {[req.user.id]: 'owner'}, banned: []};
      s.communities.push(result);
      s.channels.push({id: uuid(), communityId: result.id, name: 'geral', kind: 'text'}, {id: uuid(), communityId: result.id, name: 'Sala de conversa', kind: 'voice'});
    });
    refresh(); res.json(result);
  }));
  app.post('/api/communities/:id/invite', api(async (req, res) => {
    let invite;
    await store.change(s => {
      const c = communityFor(req.params.id, req.user);
      if (!canModerate(c, req.user)) fail(403, 'Somente proprietário e moderadores podem criar convites.');
      s.invites = s.invites.filter(i => i.expires > Date.now());
      invite = s.invites.find(i => i.communityId === c.id);
      if (!invite) {invite = {code: crypto.randomBytes(12).toString('hex'), communityId: c.id, expires: Date.now() + 7 * 86400000}; s.invites.push(invite);}
    });
    res.json(invite);
  }));
  app.post('/api/join', api(async (req, res) => {
    let id;
    await store.change(s => {
      const code = String(req.body.code || '').trim();
      const invite = s.invites.find(i => i.code === code && i.expires > Date.now());
      const c = invite && s.communities.find(c => c.id === invite.communityId);
      if (!c) fail(404, 'Convite inválido ou expirado.');
      if (c.banned.includes(req.user.id)) fail(403, 'Você foi banido desta comunidade.');
      if (Object.keys(c.members).length >= 100 && !member(c, req.user)) fail(409, 'Comunidade cheia.');
      c.members[req.user.id] ||= 'member'; id = c.id;
    });
    refresh(); res.json({id});
  }));
  app.post('/api/communities/:id/channels', api(async (req, res) => {
    let channel;
    await store.change(s => {
      const c = communityFor(req.params.id, req.user);
      if (!canModerate(c, req.user)) fail(403, 'Você precisa ser moderador.');
      if (s.channels.filter(ch => ch.communityId === c.id).length >= 50) fail(409, 'Limite de 50 canais atingido.');
      if (!['text', 'voice'].includes(req.body.kind)) fail(400, 'Tipo de canal inválido.');
      channel = {id: uuid(), communityId: c.id, name: text(req.body.name, 48, 'Canal'), kind: req.body.kind}; s.channels.push(channel);
    });
    refresh(); res.json(channel);
  }));
  app.delete('/api/channels/:id', api(async (req, res) => {
    await store.change(s => {
      const ch = conversation(req.params.id, req.user);
      if (!ch.communityId || !canModerate(communityFor(ch.communityId, req.user), req.user)) fail(403, 'Você precisa ser moderador.');
      s.channels = s.channels.filter(c => c.id !== ch.id); s.messages = s.messages.filter(m => m.channelId !== ch.id);
    });
    refresh(); res.json({ok: true});
  }));
  app.patch('/api/communities/:id/members/:userId', api(async (req, res) => {
    await store.change(() => {
      const c = communityFor(req.params.id, req.user), target = req.params.userId;
      if (!canModerate(c, req.user) || !c.members[target]) fail(403, 'Ação não permitida.');
      if (target === c.owner || target === req.user.id) fail(403, 'Não é possível alterar este membro.');
      if (req.body.action === 'ban' || req.body.action === 'kick') {
        if (member(c, req.user) !== 'owner' && c.members[target] !== 'member') fail(403, 'Somente o proprietário pode remover moderadores.');
        delete c.members[target];
        if (req.body.action === 'ban') c.banned.push(target);
      } else {
        if (c.owner !== req.user.id || !['member', 'moderator'].includes(req.body.role)) fail(403, 'Somente o proprietário pode definir cargos.');
        c.members[target] = req.body.role;
      }
    });
    refresh(); res.json({ok: true});
  }));
  app.delete('/api/communities/:id/membership', api(async (req, res) => {
    await store.change(() => {const c = communityFor(req.params.id, req.user); if (c.owner === req.user.id) fail(409, 'O proprietário precisa excluir a comunidade para sair.'); delete c.members[req.user.id];});
    refresh(); res.json({ok: true});
  }));
  app.delete('/api/communities/:id', api(async (req, res) => {
    await store.change(s => {
      const c = communityFor(req.params.id, req.user);
      if (c.owner !== req.user.id) fail(403, 'Somente o proprietário pode excluir.');
      const channels = new Set(s.channels.filter(ch => ch.communityId === c.id).map(ch => ch.id));
      s.communities = s.communities.filter(g => g.id !== c.id); s.channels = s.channels.filter(ch => !channels.has(ch.id)); s.messages = s.messages.filter(m => !channels.has(m.channelId)); s.invites = s.invites.filter(i => i.communityId !== c.id);
    });
    refresh(); res.json({ok: true});
  }));
  app.post('/api/dms', api(async (req, res) => {
    let dm;
    await store.change(s => {
      const target = s.users.find(u => u.username === String(req.body.username || '').trim().toLowerCase());
      if (!target || target.id === req.user.id) fail(404, 'Informe o usuário de outra conta.');
      // Contatos privados só podem ser iniciados entre membros de uma comunidade compartilhada.
      if (!s.communities.some(c => member(c, req.user) && c.members[target.id])) fail(403, 'Vocês precisam participar da mesma comunidade.');
      dm = s.dms.find(d => d.members.includes(target.id) && d.members.includes(req.user.id));
      if (!dm) {if (s.dms.length >= 2000) fail(409, 'Limite de conversas atingido.'); dm = {id: uuid(), members: [req.user.id, target.id]}; s.dms.push(dm);}
    });
    refresh(); res.json(dm);
  }));
  app.get('/api/channels/:id/messages', (req, res) => {
    conversation(req.params.id, req.user);
    const all = state().messages.filter(m => m.channelId === req.params.id);
    const end = req.query.before ? all.findIndex(m => m.id === req.query.before) : all.length;
    const messages = all.slice(Math.max(0, end - 80), Math.max(0, end)).map(viewMessage);
    res.json({messages, hasMore: end > 80});
  });
  app.post('/api/channels/:id/messages', api(async (req, res) => {
    let message;
    await store.change(s => {
      conversation(req.params.id, req.user);
      if (s.messages.length >= 20000) fail(409, 'Limite de 20 mil mensagens atingido. Exporte um backup e remova canais antigos.');
      const replyTo = req.body.replyTo || null;
      if (replyTo && !s.messages.some(m => m.id === replyTo && m.channelId === req.params.id)) fail(400, 'Mensagem de resposta inválida.');
      message = {id: uuid(), channelId: req.params.id, authorId: req.user.id, text: text(req.body.text, 4000, 'Mensagem'), at: Date.now(), edited: false, pinned: false, replyTo, reactions: {}};
      s.messages.push(message);
    });
    messageEvent('message', message); res.json(viewMessage(message));
  }));
  const messagePermission = (id, user) => {
    const m = state().messages.find(m => m.id === id);
    if (!m) fail(404, 'Mensagem não encontrada.');
    const ch = conversation(m.channelId, user);
    return {m, moderate: !!ch.communityId && canModerate(communityFor(ch.communityId, user), user)};
  };
  app.patch('/api/messages/:id', api(async (req, res) => {
    let message;
    await store.change(() => {
      const {m, moderate} = messagePermission(req.params.id, req.user);
      if ('text' in req.body) {if (m.authorId !== req.user.id) fail(403, 'Só o autor pode editar.'); m.text = text(req.body.text, 4000, 'Mensagem'); m.edited = true;}
      if ('pinned' in req.body) {if (!moderate) fail(403, 'Somente moderadores podem fixar mensagens.'); m.pinned = !!req.body.pinned;}
      message = m;
    });
    messageEvent('message-update', message); res.json(viewMessage(message));
  }));
  app.delete('/api/messages/:id', api(async (req, res) => {
    let message;
    await store.change(s => {const {m, moderate} = messagePermission(req.params.id, req.user); if (m.authorId !== req.user.id && !moderate) fail(403, 'Você não pode excluir esta mensagem.'); message = m; s.messages = s.messages.filter(t => t.id !== m.id);});
    broadcast({type: 'message-delete', id: message.id, channelId: message.channelId}, ws => allowed(message.channelId, ws.userId)); res.json({ok: true});
  }));
  app.post('/api/messages/:id/reactions', api(async (req, res) => {
    let message;
    await store.change(() => {
      const {m} = messagePermission(req.params.id, req.user);
      const emoji = req.body.emoji;
      if (!['👍', '❤️', '😂', '🎉', '👀'].includes(emoji)) fail(400, 'Reação inválida.');
      const users = m.reactions[emoji] || [];
      m.reactions[emoji] = users.includes(req.user.id) ? users.filter(id => id !== req.user.id) : [...users, req.user.id];
      if (!m.reactions[emoji].length) delete m.reactions[emoji]; message = m;
    });
    messageEvent('message-update', message); res.json(viewMessage(message));
  }));
  app.get('/api/admin/backup', (req, res) => {
    if (!req.user.admin) fail(403, 'Somente o administrador da instância pode exportar.');
    res.attachment('Screen-Room-v9-backup.json').json({...state(), sessions: []});
  });
  app.post('/api/admin/restore', api(async (req, res) => {
    if (!req.user.admin) fail(403, 'Somente o administrador da instância pode restaurar.');
    let backup;
    try {backup = validateState(req.body);} catch (e) {fail(400, e.message);}
    if (!backup.users.some(u => u.admin === true)) fail(400, 'Backup precisa de um administrador.');
    await store.change(s => {for (const key of Object.keys(s)) s[key] = structuredClone(backup[key]); s.sessions = [];});
    res.clearCookie('sr_session', {path: '/'}).json({ok: true, relogin: true});
    for (const ws of sockets) ws.close(1008, 'Restore');
  }));
  app.use('/api', (_req, res) => res.status(404).json({error: 'Rota não encontrada.'}));
  app.get('/', (req, res, next) => {if (req.query.room) return res.redirect('/salas.html?room=' + encodeURIComponent(String(req.query.room))); next();});
  app.use(express.static(path.join(__dirname, 'public'), {maxAge: 0}));
  app.use((e, _req, res, _next) => {if (!e.status) console.error('Request failed:', e.message); res.status(e.status || 500).json({error: e.status ? e.message : 'Falha ao salvar ou processar. Tente novamente.'});});

  function leaveCall(ws) {
    if (!ws.call) return;
    const room = calls.get(ws.call); room?.delete(ws.id);
    for (const peer of room?.values() || []) send(peer, {type: 'call-peer-left', id: ws.id});
    if (!room?.size) calls.delete(ws.call);
    ws.call = null;
  }
  const peerInfo = ws => ({id: ws.id, user: publicUser(state().users.find(u => u.id === ws.userId)), media: ws.media || {}});
  server.on('upgrade', (req, socket, head) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const origin = req.headers.origin;
    if (origin) {
      let host; try {host = new URL(origin).host;} catch {}
      if (host !== req.headers.host) {socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return socket.destroy();}
    }
    if (realtime.clients.size + legacyWss.clients.size >= 500) {socket.write('HTTP/1.1 503 Service Unavailable\r\n\r\n'); return socket.destroy();}
    if (pathname === '/signal') return legacyWss.handleUpgrade(req, socket, head, ws => legacyWss.emit('connection', ws, req));
    const user = userFor(req);
    if (pathname !== '/realtime' || !user) {socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return socket.destroy();}
    realtime.handleUpgrade(req, socket, head, ws => {ws.userId = user.id; ws.sessionHash = sessionFor(req).hash; realtime.emit('connection', ws);});
  });
  realtime.on('connection', ws => {
    ws.id = uuid(); ws.alive = true; sockets.add(ws);
    ws.on('pong', () => {ws.alive = true;});
    send(ws, {type: 'hello', id: ws.id});
    broadcast({type: 'presence'}, other => other !== ws);
    let count = 0, at = Date.now(), typedAt = 0;
    ws.on('message', raw => {
      if (Date.now() - at > 10000) {count = 0; at = Date.now();}
      if (++count > 200) return ws.close(1008, 'Rate limit');
      if (!state().sessions.some(s => s.hash === ws.sessionHash && s.expires > Date.now())) return ws.close(1008, 'Session expired');
      let m; try {m = JSON.parse(raw);} catch {return;}
      if (!m || typeof m !== 'object') return;
      const user = state().users.find(u => u.id === ws.userId);
      try {
        if (m.type === 'call-join') {
          const ch = conversation(m.channelId, user);
          if (!['voice', 'dm'].includes(ch.kind)) fail(400, 'Entre em um canal de voz ou conversa privada.');
          if (ws.call === m.channelId) return;
          if (calls.get(ch.id)?.size >= maxPeers) fail(409, 'Canal de voz cheio.');
          for (const other of sockets) if (other !== ws && other.userId === ws.userId && other.call) {leaveCall(other); send(other, {type: 'call-ended', message: 'A chamada foi aberta em outra aba.'});}
          leaveCall(ws);
          if (!calls.has(ch.id)) calls.set(ch.id, new Map());
          const room = calls.get(ch.id);
          ws.call = ch.id; ws.media = {};
          send(ws, {type: 'call-joined', channelId: ch.id, id: ws.id, peers: [...room.values()].map(peerInfo)});
          for (const peer of room.values()) send(peer, {type: 'call-peer', peer: peerInfo(ws)});
          room.set(ws.id, ws);
        } else if (m.type === 'call-leave') leaveCall(ws);
        else if (m.type === 'signal' && ws.call) {
          if (!allowed(ws.call, ws.userId)) {leaveCall(ws); return;}
          const target = calls.get(ws.call)?.get(m.to);
          if (target && target !== ws && allowed(ws.call, target.userId)) send(target, {type: 'signal', from: ws.id, description: m.description, candidate: m.candidate, slots: m.slots});
        } else if (m.type === 'media-state' && ws.call) {
          ws.media = {mic: !!m.mic, camera: !!m.camera, screen: !!m.screen};
          for (const peer of calls.get(ws.call)?.values() || []) if (peer !== ws) send(peer, {type: 'media-state', id: ws.id, media: ws.media});
        } else if (m.type === 'typing' && Date.now() - typedAt > 1500) {
          conversation(m.channelId, user); typedAt = Date.now();
          broadcast({type: 'typing', channelId: m.channelId, user: publicUser(user)}, other => other !== ws && allowed(m.channelId, other.userId));
        }
      } catch (e) {send(ws, {type: 'error', message: e.status ? e.message : 'Não foi possível processar.'});}
    });
    const cleanup = () => {leaveCall(ws); sockets.delete(ws); broadcast({type: 'presence'});};
    ws.on('close', cleanup); ws.on('error', () => ws.terminate());
  });
  const heartbeat = setInterval(() => {
    for (const wss of [realtime, legacyWss]) for (const ws of wss.clients) {if (ws.alive === false) {ws.terminate(); continue;} ws.alive = false; ws.ping();}
    for (const [key, limit] of limits) if (Date.now() - limit.at > 60000) limits.delete(key);
  }, 30000);
  heartbeat.unref();
  return {app, server, store, calls, legacyRooms, async close() {
    clearInterval(heartbeat); for (const ws of [...realtime.clients, ...legacyWss.clients]) ws.terminate();
    await new Promise(resolve => server.close(resolve)); await store.close();
  }};
}
if (require.main === module) createApplication().then(instance => {
  instance.server.listen(Number(process.env.PORT) || 3000, '0.0.0.0', () => console.log(`Screen Room v9 iniciado. Dados: ${instance.store.mode}.`));
  let stopping = false;
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {if (stopping) return; stopping = true; await instance.close(); process.exit(0);});
}).catch(e => {console.error('Não foi possível iniciar:', e.message); process.exit(1);});
module.exports = {createApplication};
