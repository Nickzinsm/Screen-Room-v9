'use strict';
// Trilhas separadas evitam tocar o mesmo áudio em vídeo e em <audio>.
// A negociação resolve ofertas simultâneas; candidatos ICE aguardam a SDP.
class ScreenRoomCall {
  constructor({send, config, toast, changed, self}) {
    Object.assign(this, {send, config, toast, changed, self});
    this.peers = new Map(); this.local = {}; this.channelId = null; this.joining = null;
    this.slots = ['mic', 'camera', 'screen', 'screenAudio']; this.muted = true;
    this.audioElements = new Map(); this.generation = 0;
  }
  media() {return {mic: !!this.local.mic && !this.muted, camera: !!this.local.camera, screen: !!this.local.screen};}
  announce() {if (this.channelId) this.send({type: 'media-state', ...this.media()}); this.render(); this.changed();}
  async join(channelId) {
    if (!this.send({type: 'call-join', channelId})) throw new Error('Aguarde a conexão com o servidor.');
    this.joining = channelId;
  }
  async handle(m) {
    if (m.type === 'call-joined') {
      this.reset(); this.id = m.id; this.channelId = m.channelId; this.joining = null;
      for (const peer of m.peers) this.addPeer(peer);
      this.announce(); this.toast('Na chamada. Ative seu microfone quando quiser falar.');
    } else if (m.type === 'call-peer' && this.channelId) {this.addPeer(m.peer); this.announce();}
    else if (m.type === 'call-peer-left') {this.removePeer(m.id); this.render();}
    else if (m.type === 'media-state') {const p = this.peers.get(m.id); if (p) {p.media = m.media; this.render();}}
    else if (m.type === 'signal' && this.channelId) {
      const p = this.peers.get(m.from); if (!p) return;
      // SDP e ICE são processados na ordem para evitar corrida de descrições.
      p.queue = p.queue.then(() => this.signal(p, m)).catch(e => {if (!p.ignoreOffer && p.pc.connectionState !== 'closed') this.toast('Falha na negociação da chamada: ' + e.message);});
    } else if (m.type === 'call-ended') {this.reset(); this.changed(); this.toast(m.message || 'Chamada encerrada.');}
  }
  addPeer(info) {
    if (this.peers.has(info.id)) return;
    const pc = new RTCPeerConnection({iceServers: this.config().iceServers, bundlePolicy: 'max-bundle'});
    const p = {id: info.id, user: info.user, media: info.media || {}, pc, tracks: {}, senders: {}, makingOffer: false, ignoreOffer: false, settingAnswer: false, polite: this.id > info.id, pending: [], remoteSlots: {}, queue: Promise.resolve()};
    this.peers.set(info.id, p);
    for (const slot of (p.polite ? [] : this.slots)) {
      const transceiver = pc.addTransceiver(['mic', 'screenAudio'].includes(slot) ? 'audio' : 'video', {direction: 'sendrecv'});
      p.senders[slot] = transceiver;
      if (this.local[slot]) transceiver.sender.replaceTrack(this.local[slot]).catch(e => this.toast(e.message));
    }
    const description = () => ({type: 'signal', to: p.id, description: pc.localDescription, slots: Object.fromEntries(Object.entries(p.senders).map(([slot, transceiver]) => [transceiver.mid, slot]).filter(([mid]) => mid !== null))});
    pc.onnegotiationneeded = async () => {
      // Só um lado inicia a primeira oferta; renegociações mantêm a resolução de colisões.
      if (p.polite && !pc.remoteDescription || pc.signalingState !== 'stable') return;
      try {p.makingOffer = true; await pc.setLocalDescription(); this.send(description());}
      catch (e) {if (pc.connectionState !== 'closed') this.toast('Não foi possível negociar a chamada.');}
      finally {p.makingOffer = false;}
    };
    p.describe = description;
    pc.onicecandidate = ({candidate}) => {if (candidate) this.send({type: 'signal', to: p.id, candidate});};
    pc.ontrack = ({track, transceiver}) => {
      const slot = p.remoteSlots[transceiver.mid] || this.slots[pc.getTransceivers().indexOf(transceiver)];
      if (!this.slots.includes(slot)) return;
      p.tracks[slot] = track;
      track.onunmute = () => this.render(); track.onended = () => {delete p.tracks[slot]; this.render();};
      this.render();
    };
    pc.onconnectionstatechange = () => {
      this.changed();
      if (pc.connectionState === 'failed') this.toast('A conexão com ' + p.user.name + ' falhou. Algumas redes exigem um servidor TURN.');
    };
    this.render();
  }
  async signal(p, m) {
    const pc = p.pc;
    if (pc.connectionState === 'closed') return;
    if (m.description) {
      const ready = !p.makingOffer && (pc.signalingState === 'stable' || p.settingAnswer);
      const collision = m.description.type === 'offer' && !ready;
      p.ignoreOffer = !p.polite && collision;
      if (p.ignoreOffer) return;
      p.settingAnswer = m.description.type === 'answer';
      p.remoteSlots = m.slots || p.remoteSlots;
      try {await pc.setRemoteDescription(m.description);} finally {p.settingAnswer = false;}
      // O receptor reutiliza as quatro trilhas da oferta. Criá-las também antes
      // da oferta geraria trilhas extras sem transporte negociado.
      for (const transceiver of pc.getTransceivers()) {
        const slot = p.remoteSlots[transceiver.mid];
        if (!this.slots.includes(slot) || p.senders[slot]) continue;
        p.senders[slot] = transceiver; transceiver.direction = 'sendrecv';
        await transceiver.sender.replaceTrack(this.local[slot] || null);
      }
      for (const candidate of p.pending.splice(0)) await pc.addIceCandidate(candidate);
      if (m.description.type === 'offer') {await pc.setLocalDescription(); this.send(p.describe());}
    } else if (m.candidate && !p.ignoreOffer) {
      if (!pc.remoteDescription) p.pending.push(m.candidate);
      else await pc.addIceCandidate(m.candidate);
    }
  }
  async replace(slot, track) {
    const previous = this.local[slot];
    if (track) this.local[slot] = track; else delete this.local[slot];
    const results = await Promise.allSettled([...this.peers.values()].map(p => p.senders[slot]?.sender.replaceTrack(track || null)));
    if (previous && previous !== track) {previous.onended = null; previous.stop();}
    const failed = results.find(r => r.status === 'rejected');
    if (failed) this.toast('Uma conexão não aceitou a nova mídia. Saia e entre na chamada.');
    this.announce();
  }
  async toggleMic() {
    if (!this.channelId) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Microfone exige HTTPS e um navegador compatível.');
    if (!this.local.mic) {
      const gen = this.generation;
      const stream = await navigator.mediaDevices.getUserMedia({audio: {echoCancellation: true, noiseSuppression: true, autoGainControl: true}});
      if (gen !== this.generation || !this.channelId) {stream.getTracks().forEach(t => t.stop()); return;}
      this.muted = false; await this.replace('mic', stream.getAudioTracks()[0]);
    } else {this.muted = !this.muted; this.local.mic.enabled = !this.muted; this.announce();}
  }
  async toggleCamera() {
    if (!this.channelId) return;
    if (this.local.camera) return this.replace('camera', null);
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Câmera exige HTTPS e um navegador compatível.');
    const gen = this.generation;
    const stream = await navigator.mediaDevices.getUserMedia({video: {width: {ideal: 1280}, height: {ideal: 720}}, audio: false});
    if (gen !== this.generation || !this.channelId) {stream.getTracks().forEach(t => t.stop()); return;}
    const track = stream.getVideoTracks()[0]; track.onended = () => this.replace('camera', null);
    await this.replace('camera', track);
  }
  async toggleScreen() {
    if (!this.channelId) return;
    if (this.local.screen) {await this.replace('screenAudio', null); return this.replace('screen', null);}
    if (!navigator.mediaDevices?.getDisplayMedia || /Android|iPhone|iPad/i.test(navigator.userAgent)) throw new Error('Este navegador móvel não captura a tela. No Android, use o aplicativo nativo com as salas por código.');
    const gen = this.generation, height = Number(document.getElementById('quality').value);
    const stream = await navigator.mediaDevices.getDisplayMedia({video: {height: {ideal: height}, frameRate: {ideal: 30, max: 30}}, audio: document.getElementById('system-audio').checked});
    if (gen !== this.generation || !this.channelId) {stream.getTracks().forEach(t => t.stop()); return;}
    const track = stream.getVideoTracks()[0]; track.contentHint = 'detail';
    track.onended = async () => {await this.replace('screenAudio', null); await this.replace('screen', null);};
    await this.replace('screen', track); await this.replace('screenAudio', stream.getAudioTracks()[0] || null);
  }
  removePeer(id) {
    const p = this.peers.get(id); if (!p) return;
    p.pc.close(); this.peers.delete(id);
    for (const [key, element] of this.audioElements) if (key.startsWith(id + ':')) {element.srcObject = null; element.remove(); this.audioElements.delete(key);}
  }
  leave() {this.send({type: 'call-leave'}); this.reset(); this.changed();}
  reset() {
    this.generation++;
    for (const track of Object.values(this.local)) {track.onended = null; track.stop();}
    this.local = {}; this.muted = true;
    for (const id of [...this.peers.keys()]) this.removePeer(id);
    this.channelId = null; this.joining = null;
    document.getElementById('sound-unlock').classList.add('hidden'); this.render();
  }
  makeTile(key, user, track, label, local = false) {
    const tile = document.createElement('div'); tile.className = 'video-tile'; tile.dataset.key = key;
    const avatar = document.createElement('span'); avatar.className = 'avatar'; avatar.textContent = user.name.slice(0, 1).toUpperCase(); tile.append(avatar);
    if (track && track.readyState !== 'ended') {
      const video = document.createElement('video'); video.autoplay = true; video.playsInline = true; video.muted = true; video.srcObject = new MediaStream([track]); tile.append(video); video.play().catch(() => {});
    }
    const name = document.createElement('span'); name.className = 'tile-name'; name.textContent = (local ? 'Você' : user.name) + ' · ' + label; tile.append(name);
    const full = document.createElement('button'); full.className = 'tile-fullscreen'; full.textContent = '⛶'; full.title = 'Tela cheia'; full.setAttribute('aria-label', 'Tela cheia: ' + user.name); full.onclick = () => tile.requestFullscreen?.().catch(e => this.toast(e.message)); tile.append(full);
    return tile;
  }
  render() {
    const grid = document.getElementById('videos'), scrollTop = grid.parentElement.scrollTop;
    // Atualizar apenas alterações de trilhas conserva o playback durante chat/presença.
    const needed = [];
    if (this.channelId) {
      const own = this.self();
      needed.push({key: 'self-camera', user: own, track: this.local.camera, label: this.muted ? 'Microfone desligado' : 'Microfone ligado', local: true});
      if (this.local.screen) needed.push({key: 'self-screen', user: own, track: this.local.screen, label: 'Tela', local: true});
      for (const p of this.peers.values()) {
        needed.push({key: p.id + '-camera', user: p.user, track: p.media.camera ? p.tracks.camera : null, label: p.pc.connectionState === 'failed' ? 'Conexão falhou' : p.media.mic ? 'Microfone ligado' : 'Microfone desligado'});
        if (p.media.screen) needed.push({key: p.id + '-screen', user: p.user, track: p.tracks.screen, label: 'Tela'});
        for (const slot of ['mic', 'screenAudio']) {
          const track = p.tracks[slot]; if (!track || track.readyState === 'ended') continue;
          const key = p.id + ':' + slot;
          let audio = this.audioElements.get(key);
          if (!audio) {audio = document.createElement('audio'); audio.autoplay = true; audio.dataset.peer = p.id; this.audioElements.set(key, audio); document.body.append(audio);}
          audio.muted = slot === 'mic' ? !p.media.mic : !p.media.screen;
          if (audio.srcObject?.getTracks()[0] !== track) {audio.srcObject = new MediaStream([track]); audio.play().catch(() => document.getElementById('sound-unlock').classList.remove('hidden'));}
        }
      }
    }
    for (const node of [...grid.children]) if (!needed.some(n => n.key === node.dataset.key)) {node.querySelectorAll('video').forEach(v => {v.srcObject = null;}); node.remove();}
    for (const info of needed) {
      let tile = [...grid.children].find(n => n.dataset.key === info.key);
      if (!tile || tile._track !== info.track) {const next = this.makeTile(info.key, info.user, info.track, info.label, info.local); next._track = info.track; if (tile) tile.replaceWith(next); else grid.append(next); tile = next;}
      tile.querySelector('.tile-name').textContent = (info.local ? 'Você' : info.user.name) + ' · ' + info.label;
    }
    grid.parentElement.scrollTop = scrollTop;
  }
  unlockAudio() {for (const audio of this.audioElements.values()) audio.play().catch(() => {}); document.getElementById('sound-unlock').classList.add('hidden');}
}
window.ScreenRoomCall = ScreenRoomCall;
