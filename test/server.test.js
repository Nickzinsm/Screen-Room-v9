'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {WebSocket} = require('ws');
const {createApplication} = require('../server');
const {createStore} = require('../store');

async function fixture(t, options = {}) {
  const instance = await createApplication({file: null, databaseUrl: '', ...options});
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  t.after(() => instance.close());
  async function request(route, cookie = '', method = 'GET', body, headers = {}) {
    const r = await fetch(base + '/api' + route, {method, headers: {cookie, ...headers, ...(body !== undefined ? {'Content-Type': 'application/json'} : {})}, body: body !== undefined ? JSON.stringify(body) : undefined});
    return {status: r.status, data: await r.json(), cookie: r.headers.get('set-cookie')?.split(';')[0]};
  }
  async function register(username) {
    const r = await request('/register', '', 'POST', {username, name: username, password: 'SenhaLonga123'}); assert.equal(r.status, 200); return {cookie: r.cookie, user: r.data.user};
  }
  async function socket(cookie, route = '/realtime') {
    const ws = new WebSocket(base.replace('http:', 'ws:') + route, {headers: {cookie}});
    const queue = [], pending = [];
    ws.on('message', raw => {
      const m = JSON.parse(raw); const waiter = pending.find(w => w.predicate(m));
      if (waiter) {pending.splice(pending.indexOf(waiter), 1); clearTimeout(waiter.timer); waiter.resolve(m);} else queue.push(m);
    });
    await new Promise((resolve, reject) => {ws.on('open', resolve); ws.on('error', reject);});
    return {ws, send(m) {ws.send(JSON.stringify(m));}, next(predicate) {
      const index = queue.findIndex(predicate); if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
      return new Promise((resolve, reject) => {const entry = {predicate, resolve}; entry.timer = setTimeout(() => {pending.splice(pending.indexOf(entry), 1); reject(new Error('Timeout aguardando evento'));}, 2000); pending.push(entry);});
    }};
  }
  return {instance, request, register, socket, base};
}

test('contas, senha, cookie, logout e bloqueio de origem externa', async t => {
  const f = await fixture(t), alice = await f.register('alice');
  assert.equal(alice.user.admin, true);
  assert.equal((await f.request('/bootstrap')).status, 401);
  assert.equal((await f.request('/register', '', 'POST', {username: 'alice', password: 'SenhaLonga123'})).status, 409);
  assert.equal((await f.request('/login', '', 'POST', {username: 'alice', password: 'SenhaErrada'})).status, 401);
  assert.equal((await f.request('/communities', alice.cookie, 'POST', {name: 'Teste'}, {Origin: 'https://evil.example'})).status, 403);
  assert.equal((await f.request('/bootstrap', alice.cookie)).data.user.username, 'alice');
  const w = await f.socket(alice.cookie); await w.next(m => m.type === 'hello');
  const closed = new Promise(resolve => w.ws.on('close', resolve));
  assert.equal((await f.request('/logout', alice.cookie, 'POST', {})).status, 200); await closed;
  assert.equal((await f.request('/bootstrap', alice.cookie)).status, 401);
  const login = await f.request('/login', '', 'POST', {username: 'alice', password: 'SenhaLonga123'});
  assert.equal(login.status, 200); assert.ok(login.cookie);
  assert.equal(f.instance.store.state.users[0].password.length, 128);
  assert.ok(!JSON.stringify(f.instance.store.state).includes('SenhaLonga123'));
});

test('comunidades privadas, convites, cargos e banimento aplicados no servidor', async t => {
  const f = await fixture(t), alice = await f.register('alice'), bob = await f.register('bob'), carol = await f.register('carol');
  const community = (await f.request('/communities', alice.cookie, 'POST', {name: 'Nossa sala'})).data;
  const bootstrap = (await f.request('/bootstrap', alice.cookie)).data, channel = bootstrap.channels[0];
  assert.equal((await f.request('/channels/' + channel.id + '/messages', bob.cookie)).status, 404);
  const invite = (await f.request('/communities/' + community.id + '/invite', alice.cookie, 'POST', {})).data;
  assert.equal((await f.request('/join', bob.cookie, 'POST', {code: invite.code})).status, 200);
  assert.equal((await f.request('/join', carol.cookie, 'POST', {code: invite.code})).status, 200);
  assert.equal((await f.request('/communities/' + community.id + '/channels', bob.cookie, 'POST', {name: 'privado', kind: 'text'})).status, 403);
  assert.equal((await f.request('/communities/' + community.id + '/members/' + bob.user.id, alice.cookie, 'PATCH', {role: 'moderator'})).status, 200);
  assert.equal((await f.request('/communities/' + community.id + '/channels', bob.cookie, 'POST', {name: 'novo', kind: 'text'})).status, 200);
  assert.equal((await f.request('/communities/' + community.id + '/members/' + alice.user.id, bob.cookie, 'PATCH', {action: 'ban'})).status, 403);
  assert.equal((await f.request('/communities/' + community.id + '/members/' + carol.user.id, bob.cookie, 'PATCH', {action: 'ban'})).status, 200);
  assert.equal((await f.request('/join', carol.cookie, 'POST', {code: invite.code})).status, 403);
  assert.equal((await f.request('/channels/' + channel.id + '/messages', carol.cookie)).status, 404);
  assert.equal((await f.request('/communities/' + community.id, bob.cookie, 'DELETE')).status, 403);
});

test('chat em tempo real, respostas, edição, reações, fixação e exclusão', async t => {
  const f = await fixture(t), alice = await f.register('alice'), bob = await f.register('bob');
  const community = (await f.request('/communities', alice.cookie, 'POST', {name: 'Chat'})).data;
  const invite = (await f.request('/communities/' + community.id + '/invite', alice.cookie, 'POST', {})).data;
  await f.request('/join', bob.cookie, 'POST', {code: invite.code});
  const ch = (await f.request('/bootstrap', alice.cookie)).data.channels[0];
  const a = await f.socket(alice.cookie), b = await f.socket(bob.cookie);
  const m = (await f.request('/channels/' + ch.id + '/messages', alice.cookie, 'POST', {text: '<img onerror=alert(1)> Oi!'})).data;
  assert.equal((await b.next(x => x.type === 'message')).message.text, m.text);
  assert.equal((await f.request('/messages/' + m.id, bob.cookie, 'PATCH', {text: 'Ataque'})).status, 403);
  assert.equal((await f.request('/messages/' + m.id, alice.cookie, 'PATCH', {text: 'Olá, mundo!'})).status, 200);
  await a.next(x => x.type === 'message-update');
  assert.equal((await f.request('/messages/' + m.id + '/reactions', bob.cookie, 'POST', {emoji: '👍'})).status, 200);
  const reaction = await f.request('/messages/' + m.id + '/reactions', bob.cookie, 'POST', {emoji: '👍'});
  assert.deepEqual(reaction.data.reactions, {});
  assert.equal((await f.request('/messages/' + m.id, bob.cookie, 'PATCH', {pinned: true})).status, 403);
  assert.equal((await f.request('/messages/' + m.id, alice.cookie, 'PATCH', {pinned: true})).status, 200);
  assert.equal((await f.request('/channels/' + ch.id + '/messages', bob.cookie, 'POST', {text: 'Respondendo', replyTo: m.id})).status, 200);
  assert.equal((await f.request('/channels/' + ch.id + '/messages', bob.cookie, 'POST', {text: 'Incorreta', replyTo: 'nonexistent'})).status, 400);
  assert.equal((await f.request('/messages/' + m.id, bob.cookie, 'DELETE')).status, 403);
  assert.equal((await f.request('/messages/' + m.id, alice.cookie, 'DELETE')).status, 200);
  assert.equal((await b.next(x => x.type === 'message-delete')).id, m.id);
});

test('DM exige comunidade compartilhada e não vaza para terceiros', async t => {
  const f = await fixture(t), alice = await f.register('alice'), bob = await f.register('bob'), carol = await f.register('carol');
  assert.equal((await f.request('/dms', alice.cookie, 'POST', {username: 'bob'})).status, 403);
  const c = (await f.request('/communities', alice.cookie, 'POST', {name: 'Amigos'})).data;
  const i = (await f.request('/communities/' + c.id + '/invite', alice.cookie, 'POST', {})).data;
  await f.request('/join', bob.cookie, 'POST', {code: i.code});
  const dm = (await f.request('/dms', alice.cookie, 'POST', {username: 'bob'})).data;
  assert.equal((await f.request('/dms', bob.cookie, 'POST', {username: 'alice'})).data.id, dm.id);
  assert.equal((await f.request('/channels/' + dm.id + '/messages', carol.cookie)).status, 404);
  const a = await f.socket(alice.cookie), b = await f.socket(bob.cookie);
  a.send({type: 'call-join', channelId: dm.id}); await a.next(m => m.type === 'call-joined');
  b.send({type: 'call-join', channelId: dm.id}); assert.equal((await b.next(m => m.type === 'call-joined')).peers.length, 1);
});

test('sinalização só dentro da chamada e banimento encerra acesso imediatamente', async t => {
  const f = await fixture(t), alice = await f.register('alice'), bob = await f.register('bob'), outsider = await f.register('outsider');
  const c = (await f.request('/communities', alice.cookie, 'POST', {name: 'Voz'})).data;
  const i = (await f.request('/communities/' + c.id + '/invite', alice.cookie, 'POST', {})).data;
  await f.request('/join', bob.cookie, 'POST', {code: i.code});
  const boot = (await f.request('/bootstrap', alice.cookie)).data, voice = boot.channels.find(c => c.kind === 'voice');
  const a = await f.socket(alice.cookie), b = await f.socket(bob.cookie), o = await f.socket(outsider.cookie);
  a.send({type: 'call-join', channelId: voice.id}); const joinedA = await a.next(m => m.type === 'call-joined');
  b.send({type: 'call-join', channelId: voice.id}); const joinedB = await b.next(m => m.type === 'call-joined');
  assert.equal(joinedB.peers[0].id, joinedA.id);
  o.send({type: 'call-join', channelId: voice.id}); assert.equal((await o.next(m => m.type === 'error')).message, 'Comunidade não encontrada.');
  a.send({type: 'signal', to: joinedB.id, description: {type: 'offer', sdp: 'test'}});
  assert.equal((await b.next(m => m.type === 'signal')).from, joinedA.id);
  a.send({type: 'media-state', mic: true, screen: true}); assert.equal((await b.next(m => m.type === 'media-state')).media.screen, true);
  await f.request('/communities/' + c.id + '/members/' + bob.user.id, alice.cookie, 'PATCH', {action: 'ban'});
  await b.next(m => m.type === 'call-ended'); assert.equal(f.instance.calls.get(voice.id).size, 1);
  assert.equal((await f.request('/channels/' + voice.id + '/messages', bob.cookie)).status, 404);
});

test('salas v7 compatíveis, mudança de sala limpa a anterior e isola sinalização', async t => {
  const f = await fixture(t), a = await f.socket('', '/signal'), b = await f.socket('', '/signal');
  a.send({type: 'join', room: 'ROOM-ABC', name: 'Android'}); const joined = await a.next(m => m.type === 'joined');
  b.send({type: 'join', room: 'ROOM-ABC', name: 'Web'}); const peer = await b.next(m => m.type === 'joined');
  assert.equal(peer.peers.length, 2);
  a.send({type: 'offer', to: peer.id, offer: {type: 'offer', sdp: 'v7'}}); assert.equal((await b.next(m => m.type === 'offer')).from, joined.id);
  a.send({type: 'join', room: 'ROOM-NEW', name: 'Android'}); await a.next(m => m.type === 'joined'); await b.next(m => m.type === 'peer-left');
  assert.equal(f.instance.legacyRooms.get('ROOM-ABC').size, 1); assert.equal(f.instance.legacyRooms.get('ROOM-NEW').size, 1);
});

test('backup restrito, validação de restauração e invalidação de sessões', async t => {
  const f = await fixture(t), alice = await f.register('alice'), bob = await f.register('bob');
  const backup = (await f.request('/admin/backup', alice.cookie)).data;
  assert.deepEqual(backup.sessions, []);
  assert.equal((await f.request('/admin/backup', bob.cookie)).status, 403);
  const malformed = structuredClone(backup); malformed.users[0].password = 'oops';
  assert.equal((await f.request('/admin/restore', alice.cookie, 'POST', malformed)).status, 400);
  assert.equal((await f.request('/admin/restore', alice.cookie, 'POST', backup)).status, 200);
  assert.equal((await f.request('/bootstrap', alice.cookie)).status, 401);
  assert.equal((await f.request('/login', '', 'POST', {username: 'alice', password: 'SenhaLonga123'})).status, 200);
});

test('persistência local atravessa reinício e falha de gravação reverte a transação', async t => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'sr-v9-')); t.after(() => fs.rm(folder, {recursive: true, force: true}));
  const file = path.join(folder, 'state.json'), f = await fixture(t, {file});
  const alice = await f.register('alice'); await f.request('/communities', alice.cookie, 'POST', {name: 'Persistente'});
  const second = await createStore({file, databaseUrl: ''});
  assert.equal(second.state.users[0].username, 'alice'); assert.equal(second.state.communities[0].name, 'Persistente'); await second.close();
  const blocked = await createStore({file: path.join(folder, 'blocked', 'state.json'), databaseUrl: ''});
  await fs.writeFile(path.join(folder, 'blocked'), 'not a folder');
  await assert.rejects(blocked.change(s => {s.users.push({id: 'should-rollback'});}));
  assert.equal(blocked.state.users.length, 0); await blocked.close();
});

test('PWA evita cache de API e páginas públicas incluem configuração correta', async t => {
  const f = await fixture(t);
  const manifest = await (await fetch(f.base + '/manifest.webmanifest')).json(); assert.equal(manifest.orientation, 'any');
  const sw = await (await fetch(f.base + '/sw.js')).text(); assert.ok(sw.includes("url.pathname.startsWith('/api/')"));
  const root = await fetch(f.base + '/?room=ROOM-OLD', {redirect: 'manual'}); assert.equal(root.status, 302); assert.equal(root.headers.get('location'), '/salas.html?room=ROOM-OLD');
  assert.equal((await f.request('/config')).data.storage, 'temporary');
});
