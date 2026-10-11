'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function emptyState() {
  return {version: 9, users: [], sessions: [], communities: [], channels: [], messages: [], dms: [], invites: []};
}
function validateState(s) {
  if (!s || s.version !== 9) throw new Error('Backup incompatível. Use um backup do Screen Room v9.');
  for (const key of Object.keys(emptyState()).filter(k => k !== 'version')) {
    if (!Array.isArray(s[key])) throw new Error('Backup inválido: ' + key);
  }
  if (s.users.length > 500 || s.messages.length > 20000 || s.communities.length > 100) throw new Error('Backup excede os limites desta edição.');
  const ids = new Set(), usernames = new Set();
  for (const u of s.users) {
    if (typeof u.id !== 'string' || ids.has(u.id) || typeof u.username !== 'string' || !/^[a-z0-9_.-]{3,24}$/.test(u.username) || typeof u.name !== 'string' || u.name.length > 32 || !/^[a-f0-9]{32}$/.test(u.salt) || !/^[a-f0-9]{128}$/.test(u.password)) throw new Error('Conta inválida no backup.');
    if (usernames.has(u.username) || typeof u.admin !== 'boolean') throw new Error('Conta duplicada ou inválida no backup.');
    ids.add(u.id); usernames.add(u.username);
  }
  for (const c of s.communities) {
    if (!ids.has(c.owner) || typeof c.name !== 'string' || c.name.length > 48 || !c.members || !Array.isArray(c.banned)) throw new Error('Comunidade inválida no backup.');
    for (const [id, role] of Object.entries(c.members)) if (!ids.has(id) || !['owner', 'moderator', 'member'].includes(role)) throw new Error('Membro inválido no backup.');
  }
  for (const c of s.channels) if (!s.communities.some(g => g.id === c.communityId) || !['text', 'voice'].includes(c.kind) || typeof c.name !== 'string') throw new Error('Canal inválido no backup.');
  for (const d of s.dms) if (!Array.isArray(d.members) || d.members.length !== 2 || !d.members.every(id => ids.has(id))) throw new Error('Conversa inválida no backup.');
  for (const m of s.messages) {
    if (!ids.has(m.authorId) || typeof m.text !== 'string' || m.text.length > 4000 || !Number.isFinite(m.at) || !m.reactions || typeof m.reactions !== 'object' || !s.channels.some(c => c.id === m.channelId) && !s.dms.some(d => d.id === m.channelId)) throw new Error('Mensagem inválida no backup.');
    for (const [emoji, users] of Object.entries(m.reactions)) if (!['👍', '❤️', '😂', '🎉', '👀'].includes(emoji) || !Array.isArray(users) || users.some(id => !ids.has(id))) throw new Error('Reação inválida no backup.');
  }
  for (const i of s.invites) if (!/^[a-f0-9]{24}$/.test(i.code) || !Number.isFinite(i.expires) || !s.communities.some(c => c.id === i.communityId)) throw new Error('Convite inválido no backup.');
  return s;
}
async function createStore(options = {}) {
  const databaseUrl = options.databaseUrl ?? process.env.DATABASE_URL;
  const file = Object.hasOwn(options, 'file') ? options.file : (process.env.RENDER ? null : path.join(__dirname, 'data', 'state.json'));
  let pool, state, mode;
  if (databaseUrl) {
    const {Pool} = require('pg');
    pool = new Pool({connectionString: databaseUrl, max: 2, connectionTimeoutMillis: 10000});
    pool.on('error', e => console.error('Conexão ociosa com o banco interrompida:', e.message));
    await pool.query('CREATE TABLE IF NOT EXISTS screen_room_state (id integer PRIMARY KEY CHECK (id = 1), state jsonb NOT NULL)');
    const result = await pool.query('SELECT state FROM screen_room_state WHERE id = 1');
    state = result.rows.length ? validateState(result.rows[0].state) : emptyState();
    mode = 'database';
  } else if (file) {
    try {state = validateState(JSON.parse(await fs.readFile(file, 'utf8')));} catch (e) {
      if (e.code !== 'ENOENT') throw e;
      state = emptyState();
    }
    mode = 'local';
  } else {state = emptyState(); mode = 'temporary';}
  let queue = Promise.resolve();
  async function persist() {
    if (pool) await pool.query('INSERT INTO screen_room_state(id,state) VALUES (1,$1) ON CONFLICT(id) DO UPDATE SET state=EXCLUDED.state', [state]);
    else if (file) {
      await fs.mkdir(path.dirname(file), {recursive: true});
      await fs.writeFile(file + '.tmp', JSON.stringify(state), {mode: 0o600});
      await fs.rename(file + '.tmp', file);
    }
  }
  return {
    mode,
    get state() {return state;},
    change(fn) {
      const work = queue.then(async () => {
        const previous = structuredClone(state);
        try {
          const result = await fn(state);
          if (Buffer.byteLength(JSON.stringify(state)) > 16 * 1024 * 1024) throw new Error('Limite de armazenamento atingido.');
          await persist();
          return result;
        } catch (e) {state = previous; throw e;}
      });
      queue = work.catch(() => {});
      return work;
    },
    async close() {await queue; if (pool) await pool.end();}
  };
}
module.exports = {createStore, validateState};
