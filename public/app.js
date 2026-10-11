'use strict';
const $ = id => document.getElementById(id);
const escapeHtml = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const hide = (id, yes) => $(id).classList.toggle('hidden', yes);
const roleName = {owner: 'Proprietário', moderator: 'Moderador', member: 'Membro'};
let data, config, selectedCommunity = null, selectedChannel = null, messages = [], hasMore = false, replyTo = null, onlyPins = false;
let ws, reconnect, retries = 0, signedOut = true, registerMode = false, messageGeneration = 0, typingTimer;
let bootstrapQueue = Promise.resolve();
$('auth-submit').disabled = true;
const drafts = new Map();
let pendingInvite = new URLSearchParams(location.search).get('invite');
function toast(message) { $('toast').textContent = message; hide('toast', false); clearTimeout(toast.timer); toast.timer = setTimeout(() => hide('toast', true), 4500); }
async function api(url, method = 'GET', body) {
  const response = await fetch('/api' + url, {method, headers: body !== undefined ? {'Content-Type': 'application/json'} : {}, body: body !== undefined ? JSON.stringify(body) : undefined, credentials: 'same-origin'});
  const result = await response.json();
  if (!response.ok) {const e = new Error(result.error || 'Não foi possível concluir.'); e.status = response.status; throw e;}
  return result;
}
const safe = fn => async (...args) => {try {await fn(...args);} catch (e) {toast(e.message);}};
function send(message) {if (ws?.readyState !== WebSocket.OPEN) return false; ws.send(JSON.stringify(message)); return true;}
const call = new ScreenRoomCall({send, config: () => data, toast, changed: renderCall, self: () => data?.user || {name: 'Você'}});
function applyTheme(theme) {
  document.body.dataset.theme = theme === 'night' ? 'night' : 'light';
  const night = theme === 'night'; $('theme').textContent = night ? '☾ Night' : '☀ Claro'; $('theme').setAttribute('aria-label', night ? 'Ativar tema claro' : 'Ativar tema Night');
  document.querySelector('meta[name=theme-color]').content = night ? '#071a35' : '#65ccec';
  try {localStorage.setItem('screen-room-theme', document.body.dataset.theme);} catch {}
}
let savedTheme; try {savedTheme = localStorage.getItem('screen-room-theme');} catch {}
applyTheme(savedTheme);
$('theme').onclick = () => applyTheme(document.body.dataset.theme === 'night' ? 'light' : 'night');
window.addEventListener('storage', e => {if (e.key === 'screen-room-theme') applyTheme(e.newValue);});
function authMode(register) {
  registerMode = register; hide('name-field', !register); $('display-name').required = register;
  $('login-tab').classList.toggle('selected', !register); $('register-tab').classList.toggle('selected', register);
  $('auth-title').textContent = register ? 'Encontre seu lugar.' : 'Bom ter você aqui.';
  $('auth-subtitle').textContent = register ? 'Uma conta, muitas conversas para começar.' : 'Entre para encontrar sua comunidade.';
  $('auth-submit').textContent = register ? 'Criar minha conta ↗' : 'Entrar no Screen Room ↗';
  $('password').autocomplete = register ? 'new-password' : 'current-password'; $('auth-error').textContent = '';
}
$('login-tab').onclick = () => authMode(false); $('register-tab').onclick = () => authMode(true);
$('auth-form').onsubmit = async event => {
  event.preventDefault(); $('auth-submit').disabled = true; $('auth-error').textContent = '';
  try {
    await api(registerMode ? '/register' : '/login', 'POST', {username: $('username').value, password: $('password').value, name: $('display-name').value});
    $('password').value = ''; await startSession();
  } catch (e) {$('auth-error').textContent = e.message;} finally {$('auth-submit').disabled = false;}
};
function showAuth(message) {
  signedOut = true; clearTimeout(reconnect); ws?.close(); call.reset(); data = null; selectedCommunity = selectedChannel = null; drafts.clear();
  hide('workspace', true); hide('auth', false); document.body.classList.remove('authenticated', 'in-call', 'drawer-open');
  if (message) $('auth-error').textContent = message;
}
async function startSession() {
  signedOut = false; await bootstrap(); hide('auth', true); hide('workspace', false); document.body.classList.add('authenticated'); connect();
  if (pendingInvite) {const code = pendingInvite; pendingInvite = null; try {const result = await api('/join', 'POST', {code}); await bootstrap(); chooseCommunity(result.id);} catch (e) {toast(e.message);} history.replaceState(null, '', '/');}
}
function bootstrap() {
  const work = bootstrapQueue.catch(() => {}).then(async () => {
    data = await api('/bootstrap');
    if (selectedCommunity && !data.communities.some(c => c.id === selectedCommunity)) {selectedCommunity = selectedChannel = null;}
    if (selectedChannel && !getChannel(selectedChannel)) {selectedChannel = null; messages = [];}
    render();
  });
  bootstrapQueue = work; return work;
}
function connect() {
  clearTimeout(reconnect); if (signedOut) return;
  const connection = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/realtime`); ws = connection;
  connection.onopen = () => {if (ws !== connection) return; retries = 0; bootstrap().catch(e => e.status === 401 ? showAuth('Entre novamente.') : toast(e.message)); if (selectedChannel) loadMessages().catch(e => toast(e.message));};
  connection.onmessage = async event => {
    if (ws !== connection) return;
    let m; try {m = JSON.parse(event.data);} catch {return;}
    try {
      if (m.type.startsWith('call-') || ['signal', 'media-state'].includes(m.type)) await call.handle(m);
      else if (['refresh', 'presence'].includes(m.type)) await bootstrap();
      else if (m.type === 'error') {call.joining = null; renderCall(); toast(m.message);}
      else if (['message', 'message-update'].includes(m.type) && m.channelId === selectedChannel) {
        const nearBottom = $('messages').scrollHeight - $('messages').scrollTop - $('messages').clientHeight < 100;
        const index = messages.findIndex(t => t.id === m.message.id);
        if (index >= 0) messages[index] = m.message; else messages.push(m.message);
        renderMessages(nearBottom); $('typing').textContent = '';
      } else if (m.type === 'message-delete' && m.channelId === selectedChannel) {messages = messages.filter(t => t.id !== m.id); renderMessages(false);}
      else if (m.type === 'typing' && m.channelId === selectedChannel && m.user.id !== data.user.id) {$('typing').textContent = m.user.name + ' está escrevendo…'; clearTimeout(typingTimer); typingTimer = setTimeout(() => $('typing').textContent = '', 3500);}
    } catch (e) {if (e.status === 401) showAuth('Sua sessão terminou. Entre novamente.'); else toast(e.message);}
  };
  connection.onclose = () => {
    if (ws !== connection || signedOut) return;
    if (call.channelId) {call.reset(); renderCall(); toast('Conexão interrompida. Entre novamente na chamada após reconectar.');}
    $('channel-subtitle').textContent = 'Reconectando ao servidor…';
    reconnect = setTimeout(async () => {try {await bootstrap(); connect();} catch (e) {if (e.status === 401) showAuth('Sua sessão terminou. Entre novamente.'); else connect();}}, Math.min(30000, 1000 * 2 ** retries++));
  };
}
function currentCommunity() {return data?.communities.find(c => c.id === selectedCommunity);}
function getChannel(id) {return data?.channels.find(c => c.id === id) || data?.dms.find(d => d.id === id);}
function channelName(ch) {return ch?.name || ch?.users?.find(u => u.id !== data.user.id)?.name || 'Conversa';}
function myRole() {return currentCommunity()?.members.find(m => m.id === data.user.id)?.role;}
function moderation() {return ['owner', 'moderator'].includes(myRole());}
function chooseCommunity(id) {
  selectedCommunity = id; selectedChannel = null; onlyPins = false;
  const choices = id ? data.channels.filter(c => c.communityId === id) : data.dms;
  render(); if (choices.length) chooseChannel(choices[0].id).catch(e => toast(e.message));
}
async function chooseChannel(id) {
  if (selectedChannel) drafts.set(selectedChannel, $('message-input').value);
  selectedChannel = id; replyTo = null; onlyPins = false; $('search').value = ''; hide('search-row', true);
  $('message-input').value = drafts.get(id) || ''; $('typing').textContent = ''; clearTimeout(typingTimer); messages = []; hasMore = false;
  document.body.classList.remove('drawer-open'); render();
  await loadMessages();
}
async function loadMessages(older = false) {
  const id = selectedChannel, gen = ++messageGeneration; if (!id) return;
  const result = await api('/channels/' + id + '/messages' + (older && messages[0] ? '?before=' + messages[0].id : ''));
  if (selectedChannel !== id || gen !== messageGeneration) return;
  // Eventos que chegaram durante a leitura não devem desaparecer.
  const merged = new Map((older ? [...result.messages, ...messages] : [...result.messages, ...messages.filter(m => m.at >= (result.messages.at(-1)?.at || 0))]).map(m => [m.id, m]));
  messages = [...merged.values()].sort((a, b) => a.at - b.at); hasMore = result.hasMore; renderMessages(!older);
}
function render() {
  if (!data) return;
  $('communities').innerHTML = `<button class="community-button ${selectedCommunity ? '' : 'selected'}" data-community="" title="Conversas privadas" aria-label="Conversas privadas">◈</button><span class="rail-divider"></span>` + data.communities.map(c => `<button class="community-button ${c.id === selectedCommunity ? 'selected' : ''}" data-community="${escapeHtml(c.id)}" title="${escapeHtml(c.name)}" aria-label="${escapeHtml(c.name)}">${escapeHtml(c.name.slice(0, 2).toUpperCase())}</button>`).join('') + '<span class="rail-divider"></span><button class="community-button add" id="rail-create" title="Criar comunidade" aria-label="Criar comunidade">+</button><button class="community-button" id="rail-join" title="Entrar com convite" aria-label="Entrar com convite">↗</button>';
  $('communities').querySelectorAll('[data-community]').forEach(b => b.onclick = () => chooseCommunity(b.dataset.community || null));
  $('rail-create').onclick = createCommunity; $('rail-join').onclick = joinCommunity;
  const community = currentCommunity(), channel = getChannel(selectedChannel);
  $('community-title').textContent = community?.name || 'Conversas'; $('channels-label').textContent = community ? 'CANAIS DA COMUNIDADE' : 'CONVERSAS PRIVADAS';
  const channels = community ? data.channels.filter(c => c.communityId === community.id) : data.dms;
  $('channel-list').innerHTML = channels.length ? channels.map(c => `<button class="channel-button ${c.id === selectedChannel ? 'selected' : ''}" data-channel="${escapeHtml(c.id)}"><span class="channel-glyph">${c.kind === 'text' ? '#' : c.kind === 'voice' ? '♬' : '↗'}</span><span>${escapeHtml(channelName(c))}</span></button>`).join('') : '<p class="dialog-copy" style="padding:8px">' + (community ? 'Adicione seu primeiro canal.' : 'Encontre alguém na sua comunidade e comece uma conversa.') + '</p>';
  $('channel-list').querySelectorAll('[data-channel]').forEach(b => b.onclick = safe(() => chooseChannel(b.dataset.channel)));
  hide('invite', !community || !moderation()); hide('add-channel', !!community && !moderation());
  $('my-name').textContent = data.user.name; $('my-username').textContent = '@' + data.user.username; $('my-avatar').textContent = data.user.name.slice(0, 1).toUpperCase();
  hide('storage-banner', data.storage !== 'temporary'); hide('backup-banner', !data.user.admin);
  $('channel-title').textContent = channel ? channelName(channel) : 'Vamos começar?'; $('channel-icon').textContent = channel?.kind === 'text' ? '#' : channel?.kind === 'voice' ? '♬' : '◈';
  $('channel-subtitle').textContent = channel ? (channel.kind === 'voice' ? 'Voz, vídeo e tela — reúna seus amigos.' : 'Um espaço para compartilhar ideias.') : 'Escolha um canal para conversar.';
  hide('welcome', !!channel); hide('messages', !channel); hide('composer', !channel); hide('pins', !channel || !community); hide('search-toggle', !channel);
  const members = community ? community.members : channel?.users?.map(u => ({...u, role: 'member'})) || [];
  $('member-count').textContent = members.length;
  $('member-list').innerHTML = members.map(u => `<button class="member ${u.online ? 'online' : ''}" data-member="${escapeHtml(u.id)}"><span class="avatar">${escapeHtml(u.name.slice(0, 1).toUpperCase())}</span><span class="member-info"><strong>${escapeHtml(u.name)}</strong><small>${community ? roleName[u.role] : '@' + escapeHtml(u.username)}</small></span></button>`).join('');
  $('member-list').querySelectorAll('[data-member]').forEach(b => b.onclick = () => showMember(members.find(u => u.id === b.dataset.member)));
  renderCall(); renderReply();
}
function renderCall() {
  if (!data) return;
  const ch = getChannel(selectedChannel), active = !!call.channelId, activeChannel = getChannel(call.channelId);
  hide('voice-stage', !active && !['voice', undefined].includes(ch?.kind));
  if (!ch && !active) hide('voice-stage', true);
  $('voice-title').textContent = active ? channelName(activeChannel) : ch ? channelName(ch) : 'Sala de conversa';
  $('call-status').textContent = active ? `${call.peers.size + 1} na chamada` : 'Fora da chamada';
  hide('call-empty', active); hide('call-join', active); $('call-join').textContent = 'Entrar na chamada';
  for (const id of ['mic', 'camera', 'share', 'call-leave', 'quality', 'system-audio-label']) hide(id, !active);
  document.body.classList.toggle('in-call', active);
  const media = call.media();
  $('mic').textContent = media.mic ? 'Desligar mic' : 'Ativar mic'; $('mic').classList.toggle('active', media.mic);
  $('camera').textContent = media.camera ? 'Desligar câmera' : 'Câmera'; $('camera').classList.toggle('active', media.camera);
  $('share').textContent = media.screen ? 'Parar tela' : 'Compartilhar tela'; $('share').classList.toggle('active', media.screen);
}
function richText(value) {
  const pattern = /https?:\/\/[^\s<>]+/g; let last = 0, result = '', match;
  while ((match = pattern.exec(value))) {result += escapeHtml(value.slice(last, match.index)); result += `<a href="${escapeHtml(match[0])}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[0])}</a>`; last = pattern.lastIndex;}
  return result + escapeHtml(value.slice(last));
}
function renderMessages(bottom) {
  const element = $('messages'), scroll = element.scrollTop, previousHeight = element.scrollHeight;
  const query = $('search').value.toLocaleLowerCase('pt-BR');
  const visible = messages.filter(m => (!onlyPins || m.pinned) && (!query || m.text.toLocaleLowerCase('pt-BR').includes(query)));
  const own = data.user.id;
  element.innerHTML = (hasMore ? '<button id="load-more" class="load-more">Carregar mensagens anteriores</button>' : '') + (visible.length ? visible.map(m => {
    const parent = messages.find(t => t.id === m.replyTo), mod = moderation(), canDelete = m.authorId === own || mod;
    return `<article class="message ${m.pinned ? 'pinned' : ''}" data-message="${escapeHtml(m.id)}"><span class="avatar">${escapeHtml(m.author.name.slice(0, 1).toUpperCase())}</span><div class="message-main"><div class="message-meta"><strong>${escapeHtml(m.author.name)}</strong><time datetime="${new Date(m.at).toISOString()}">${new Date(m.at).toLocaleString('pt-BR', {day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'})}</time>${m.edited ? '<small>editada</small>' : ''}${m.pinned ? '<small>⌖ fixada</small>' : ''}</div>${m.replyTo ? `<div class="message-reply">↳ ${parent ? escapeHtml(parent.author.name + ': ' + parent.text.slice(0, 100)) : 'Resposta a uma mensagem anterior'}</div>` : ''}<p class="message-text">${richText(m.text)}</p><div class="reactions">${Object.entries(m.reactions).map(([emoji, ids]) => `<button class="reaction ${ids.includes(own) ? 'mine' : ''}" data-action="react" data-emoji="${emoji}">${emoji} ${ids.length}</button>`).join('')}</div><div class="message-tools"><button data-action="reply">Responder</button><button data-action="react" data-emoji="👍">👍</button><button data-action="react" data-emoji="❤️">❤️</button>${m.authorId === own ? '<button data-action="edit">Editar</button>' : ''}${mod ? `<button data-action="pin">${m.pinned ? 'Desafixar' : 'Fixar'}</button>` : ''}${canDelete ? '<button data-action="delete">Excluir</button>' : ''}</div></div></article>`;
  }).join('') : `<div class="message-system">${onlyPins ? 'Nenhuma mensagem fixada neste canal.' : query ? 'Nenhuma mensagem carregada corresponde à pesquisa.' : 'Este é o começo da conversa.<br>Que tal dizer oi? ☀'}</div>`);
  $('load-more')?.addEventListener('click', safe(() => loadMessages(true)));
  element.querySelectorAll('[data-action]').forEach(button => button.onclick = safe(async () => {
    const message = messages.find(m => m.id === button.closest('[data-message]').dataset.message);
    if (button.dataset.action === 'reply') {replyTo = message; renderReply(); $('message-input').focus();}
    else if (button.dataset.action === 'react') await api('/messages/' + message.id + '/reactions', 'POST', {emoji: button.dataset.emoji});
    else if (button.dataset.action === 'pin') await api('/messages/' + message.id, 'PATCH', {pinned: !message.pinned});
    else if (button.dataset.action === 'edit') openForm('Editar mensagem', `<label>Mensagem<textarea name="text" maxlength="4000" required rows="4">${escapeHtml(message.text)}</textarea></label>`, async values => {await api('/messages/' + message.id, 'PATCH', {text: values.text});});
    else if (button.dataset.action === 'delete') confirmAction('Excluir mensagem?', 'Esta mensagem será removida para todos.', () => api('/messages/' + message.id, 'DELETE'));
  }));
  if (bottom) element.scrollTop = element.scrollHeight;
  else element.scrollTop = scroll + (hasMore && previousHeight && element.scrollHeight > previousHeight && scroll < 30 ? element.scrollHeight - previousHeight : 0);
}
function renderReply() {
  hide('reply-bar', !replyTo);
  if (replyTo) {$('reply-bar').innerHTML = `<span>Respondendo a ${escapeHtml(replyTo.author.name)}: ${escapeHtml(replyTo.text.slice(0, 80))}</span><button class="icon-button" type="button" aria-label="Cancelar resposta">×</button>`; $('reply-bar').querySelector('button').onclick = () => {replyTo = null; renderReply();};}
}
$('composer').onsubmit = safe(async event => {
  event.preventDefault(); const value = $('message-input').value.trim(), channelId = selectedChannel; if (!value || !channelId) return;
  const button = $('composer').querySelector('[type=submit]'); if (button.disabled) return; button.disabled = true;
  try {await api('/channels/' + channelId + '/messages', 'POST', {text: value, replyTo: replyTo?.id || null}); if (selectedChannel === channelId && $('message-input').value.trim() === value) {$('message-input').value = ''; $('message-input').style.height = ''; drafts.delete(channelId); replyTo = null; renderReply();}}
  finally {button.disabled = false;}
});
$('message-input').addEventListener('keydown', event => {if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {event.preventDefault(); $('composer').requestSubmit();}});
$('message-input').oninput = () => {$('message-input').style.height = 'auto'; $('message-input').style.height = Math.min(120, $('message-input').scrollHeight) + 'px'; if (selectedChannel) send({type: 'typing', channelId: selectedChannel});};
$('emoji').onclick = () => {
  openDialog('Um toque de alegria', '<div class="dialog-actions">' + ['☀️', '🌊', '👍', '❤️', '😂', '🎉', '👀', '🌿'].map(e => `<button class="button" data-emoji="${e}">${e}</button>`).join('') + '</div>');
  $('dialog-body').querySelectorAll('[data-emoji]').forEach(b => b.onclick = () => {$('message-input').value += b.dataset.emoji; $('dialog').close(); $('message-input').focus();});
};
function openDialog(title, content) {$('dialog-title').textContent = title; $('dialog-body').innerHTML = content; $('dialog-error').textContent = ''; if (!$('dialog').open) $('dialog').showModal();}
$('dialog-close').onclick = () => $('dialog').close();
function openForm(title, fields, submit, label = 'Salvar') {
  openDialog(title, `<form id="dialog-form">${fields}<div class="dialog-actions"><button class="button primary" type="submit">${label}</button></div></form>`);
  $('dialog-form').onsubmit = async event => {event.preventDefault(); const button = event.currentTarget.querySelector('[type=submit]'); button.disabled = true; $('dialog-error').textContent = ''; try {await submit(Object.fromEntries(new FormData(event.currentTarget))); $('dialog').close();} catch (e) {$('dialog-error').textContent = e.message;} finally {button.disabled = false;}};
}
function confirmAction(title, description, action) {openForm(title, `<p class="dialog-copy">${escapeHtml(description)}</p>`, async () => {await action();}, 'Confirmar');}
function createCommunity() {openForm('Uma comunidade só sua', '<p class="dialog-copy">Um lugar para seus amigos, projetos e boas conversas.</p><label>Nome da comunidade<input name="name" maxlength="48" required placeholder="Nosso cantinho"></label>', async values => {const c = await api('/communities', 'POST', values); await bootstrap(); chooseCommunity(c.id);}, 'Criar comunidade');}
function joinCommunity() {openForm('Entre com um convite', '<label>Link ou código do convite<input name="code" required placeholder="Cole aqui o convite"></label>', async values => {let code = values.code.trim(); if (/^https?:\/\//.test(code)) code = new URL(code).searchParams.get('invite') || ''; const result = await api('/join', 'POST', {code}); await bootstrap(); chooseCommunity(result.id);}, 'Entrar na comunidade');}
$('welcome-create').onclick = createCommunity; $('welcome-join').onclick = joinCommunity;
$('add-channel').onclick = () => {
  const c = currentCommunity();
  if (c) openForm('Novo canal', '<label>Nome<input name="name" maxlength="48" required placeholder="conversa-geral"></label><label>Tipo<select name="kind"><option value="text">Texto</option><option value="voice">Voz, vídeo e tela</option></select></label>', async values => {const ch = await api('/communities/' + c.id + '/channels', 'POST', values); await bootstrap(); await chooseChannel(ch.id);}, 'Criar canal');
  else openForm('Nova conversa privada', '<p class="dialog-copy">Converse com alguém que participa de uma das suas comunidades.</p><label>Nome de usuário<input name="username" required placeholder="amigo.usuario"></label>', async values => {const dm = await api('/dms', 'POST', values); await bootstrap(); selectedCommunity = null; await chooseChannel(dm.id);}, 'Abrir conversa');
};
$('invite').onclick = safe(async () => {
  const result = await api('/communities/' + selectedCommunity + '/invite', 'POST', {}), url = location.origin + '/?invite=' + result.code;
  openDialog('Convide seus amigos', `<p class="dialog-copy">Compartilhe este link. O convite expira em sete dias.</p><label>Link<input readonly value="${escapeHtml(url)}"></label><button id="copy-invite" class="button primary wide">Copiar convite</button>`);
  $('copy-invite').onclick = safe(async () => {try {await navigator.clipboard.writeText(url); toast('Convite copiado!');} catch {$('dialog-body').querySelector('input').select(); toast('Selecione e copie o link.');}});
});
$('community-menu').onclick = () => {
  const c = currentCommunity(), ch = getChannel(selectedChannel);
  if (!c) return $('settings').click();
  openDialog(c.name, '<div class="menu-list">' + (moderation() ? '<button id="menu-invite" class="button">Convidar amigos</button>' : '') + (moderation() && ch ? '<button id="delete-channel" class="button danger">Excluir canal atual</button>' : '') + `<button id="leave-community" class="button danger">${c.owner === data.user.id ? 'Excluir comunidade' : 'Sair da comunidade'}</button></div>`);
  $('menu-invite')?.addEventListener('click', () => $('invite').click());
  $('delete-channel')?.addEventListener('click', () => confirmAction('Excluir canal?', 'Todas as mensagens deste canal serão removidas.', async () => {await api('/channels/' + ch.id, 'DELETE'); await bootstrap(); chooseCommunity(c.id);}));
  $('leave-community').onclick = () => confirmAction(c.owner === data.user.id ? 'Excluir comunidade?' : 'Sair da comunidade?', c.owner === data.user.id ? 'Isso remove os canais e mensagens para todos os membros.' : 'Você precisará de um convite para voltar.', async () => {await api('/communities/' + c.id + (c.owner === data.user.id ? '' : '/membership'), 'DELETE'); await bootstrap(); chooseCommunity(null);});
};
function showMember(user) {
  const c = currentCommunity(), isSelf = user.id === data.user.id;
  openDialog(user.name, `<p class="dialog-copy">@${escapeHtml(user.username)}</p><p class="dialog-copy">${escapeHtml(user.bio || 'Que bom ter você por aqui.')}</p><div class="menu-list">${isSelf ? '<button id="edit-profile" class="button">Editar meu perfil</button>' : '<button id="open-dm" class="button primary">Conversar em particular</button>'}${c && !isSelf && c.owner !== user.id && moderation() ? `${myRole() === 'owner' ? '<button id="member-role" class="button">' + (user.role === 'moderator' ? 'Remover cargo de moderador' : 'Tornar moderador') + '</button>' : ''}<button id="member-kick" class="button danger">Remover da comunidade</button><button id="member-ban" class="button danger">Banir da comunidade</button>` : ''}</div>`);
  $('edit-profile')?.addEventListener('click', editProfile);
  $('open-dm')?.addEventListener('click', safe(async () => {const dm = await api('/dms', 'POST', {username: user.username}); $('dialog').close(); await bootstrap(); selectedCommunity = null; await chooseChannel(dm.id);}));
  $('member-role')?.addEventListener('click', safe(async () => {await api('/communities/' + c.id + '/members/' + user.id, 'PATCH', {role: user.role === 'moderator' ? 'member' : 'moderator'}); $('dialog').close(); await bootstrap();}));
  for (const action of ['kick', 'ban']) $('member-' + action)?.addEventListener('click', () => confirmAction(action === 'ban' ? 'Banir este membro?' : 'Remover este membro?', action === 'ban' ? 'Ele não poderá voltar com os convites atuais. Esta edição não tem painel de desbanimento.' : 'Ele poderá voltar com um convite.', async () => {await api('/communities/' + c.id + '/members/' + user.id, 'PATCH', {action}); await bootstrap();}));
}
function editProfile() {openForm('Seu perfil', `<label>Nome<input name="name" maxlength="32" required value="${escapeHtml(data.user.name)}"></label><label>Sobre você<textarea name="bio" maxlength="160" rows="3">${escapeHtml(data.user.bio)}</textarea></label>`, async values => {await api('/profile', 'PATCH', values); await bootstrap();});}
$('profile').onclick = editProfile;
$('settings').onclick = () => {
  openDialog('Seu Screen Room', `<p class="dialog-copy">${data.storage === 'temporary' ? 'Modo temporário: o servidor perde os dados quando reinicia. O administrador pode baixar e restaurar um backup ou configurar um banco externo.' : data.storage === 'database' ? 'Contas e mensagens estão guardadas no banco externo configurado.' : 'Os dados estão guardados neste computador.'}</p><div class="menu-list"><button id="settings-profile" class="button">Editar perfil</button>${data.user.admin ? '<button id="settings-backup" class="button">Baixar backup da instância</button><button id="settings-restore" class="button">Restaurar backup</button>' : ''}<a class="button" href="/salas.html">Abrir salas por código</a><button id="settings-logout" class="button danger">Sair da conta</button></div>`);
  $('settings-profile').onclick = editProfile;
  $('settings-backup')?.addEventListener('click', downloadBackup);
  $('settings-restore')?.addEventListener('click', restoreBackup);
  $('settings-logout').onclick = safe(async () => {await api('/logout', 'POST', {}); $('dialog').close(); showAuth();});
};
function downloadBackup() {openDialog('Guarde sua comunidade', '<p class="dialog-copy">O backup inclui todas as contas, históricos e hashes de senha desta instância. Guarde-o em um local privado. As sessões e as chamadas não são incluídas.</p><a class="button primary wide" href="/api/admin/backup" download>Baixar backup JSON</a>');}
$('backup-banner').onclick = downloadBackup;
function restoreBackup() {
  openForm('Restaurar a instância', '<p class="dialog-copy">Isso substitui todos os dados atuais. Depois, entre com o usuário e a senha que existiam no backup. Baixe uma cópia dos dados atuais antes de continuar.</p><label>Backup do Screen Room v9<input id="backup-file" type="file" accept=".json,application/json" required></label><label class="check-label"><input type="checkbox" required> Entendo que os dados atuais serão substituídos.</label>', async () => {
    const file = $('backup-file').files[0]; if (file.size > 16 * 1024 * 1024) throw new Error('Backup maior que 16 MB.');
    const backup = JSON.parse(await file.text()); await api('/admin/restore', 'POST', backup); showAuth('Backup restaurado. Entre com sua conta do backup.');
  }, 'Restaurar e sair');
}
$('pins').onclick = () => {onlyPins = !onlyPins; $('pins').classList.toggle('active', onlyPins); renderMessages(true);};
$('search-toggle').onclick = () => {hide('search-row', !$('search-row').classList.contains('hidden')); if (!$('search-row').classList.contains('hidden')) $('search').focus();};
$('search').oninput = () => renderMessages(true);
$('search-close').onclick = () => {$('search').value = ''; hide('search-row', true); renderMessages(true);};
$('nav-toggle').onclick = () => document.body.classList.toggle('drawer-open'); $('drawer-shade').onclick = () => document.body.classList.remove('drawer-open');
$('members-toggle').onclick = () => {if (innerWidth > 1100) document.body.classList.toggle('members-closed'); else document.body.classList.toggle('members-open');};
$('call-join').onclick = safe(async () => {if (selectedChannel) await call.join(selectedChannel);});
$('mic').onclick = safe(() => call.toggleMic()); $('camera').onclick = safe(() => call.toggleCamera()); $('share').onclick = safe(() => call.toggleScreen()); $('call-leave').onclick = () => call.leave(); $('sound-unlock').onclick = () => call.unlockAudio();
$('system-audio').onchange = () => {if ($('system-audio').checked) toast('Áudio da tela pode retransmitir a própria chamada. Prefira compartilhar só uma aba.');};
window.addEventListener('beforeunload', () => call.reset());
let installPrompt;
window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); installPrompt = event; hide('install', false);});
$('install').onclick = safe(async () => {await installPrompt?.prompt(); hide('install', true);});
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
(async () => {
  try {config = await api('/config'); hide('auth-storage', config.storage !== 'temporary'); await startSession();}
  catch (e) {showAuth(e.status === 401 ? '' : 'Não foi possível conectar. Aguarde o servidor iniciar e atualize a página.');}
  finally {$('auth-submit').disabled = false;}
})();
