const assert = require('node:assert/strict');
const {chromium} = require('playwright');
const {createApplication} = require('../server');
const fs = require('node:fs/promises');
(async () => {
  const instance = await createApplication({file: null, databaseUrl: ''});
  await new Promise(resolve => instance.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${instance.server.address().port}`;
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--allow-loopback-in-peer-connection', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream']});
  const errors = [];
  await fs.mkdir(__dirname + '/browser-output', {recursive: true});
  const ctx = await browser.newContext({viewport: {width: 1440, height: 900}, permissions: ['microphone', 'camera']});
  const ctx2 = await browser.newContext({viewport: {width: 1280, height: 800}, permissions: ['microphone', 'camera']});
  const alice = await ctx.newPage(), bob = await ctx2.newPage();
  for (const p of [alice, bob]) p.on('pageerror', e => errors.push(e.message));
  async function register(page, username, url = base) {
    await page.goto(url); await page.click('#register-tab');
    await page.fill('#display-name', username === 'alice' ? 'Nick' : 'Marina');
    await page.fill('#username', username); await page.fill('#password', 'SenhaLonga123');
    await page.click('#auth-submit'); await page.waitForSelector('#workspace:not(.hidden)');
    await page.waitForFunction(() => ws?.readyState === WebSocket.OPEN);
  }
  try {
    await alice.goto(base); await alice.waitForSelector('#auth-card, .auth-card');
    await alice.screenshot({path: __dirname + '/browser-output/login-light.png'});
    await register(alice, 'alice');
    await alice.click('#welcome-create'); await alice.fill('#dialog input[name=name]', 'Nosso cantinho'); await alice.click('#dialog [type=submit]');
    await alice.waitForSelector('#channel-list button.selected');
    await alice.click('#invite'); await alice.waitForSelector('#copy-invite');
    const invite = await alice.inputValue('#dialog input'); await alice.click('#dialog-close');
    await register(bob, 'bob', invite);
    try {await bob.waitForFunction(() => data.communities.length === 1 && selectedChannel, null, {timeout: 5000});} catch (e) {console.log('Bob state', await bob.evaluate(() => ({url:location.href,pendingInvite,communities:data?.communities,channels:data?.channels,selectedCommunity,selectedChannel,toast:document.getElementById('toast').textContent}))); await bob.screenshot({path:__dirname+'/browser-output/bob-error.png'}); throw e;}
    await alice.fill('#message-input', 'Oi, Marina! <img src=x onerror="window.injected=1">'); await alice.press('#message-input', 'Enter');
    await bob.waitForSelector('.message-text'); assert.ok((await bob.textContent('.message-text')).includes('<img'));
    assert.equal(await bob.evaluate(() => window.injected), undefined); assert.equal(await bob.locator('.message-text img').count(), 0);
    await bob.fill('#message-input', 'Oi! O tema ficou muito bonito 🌊'); await bob.press('#message-input', 'Enter');
    await alice.waitForFunction(() => messages.length === 2);
    await alice.locator('.message-tools [data-action=edit]').first().click({force: true});
    await alice.fill('#dialog textarea', 'Bem-vinda ao nosso cantinho! ☀'); await alice.click('#dialog [type=submit]');
    await bob.waitForFunction(() => messages.some(m => m.text === 'Bem-vinda ao nosso cantinho! ☀'));
    await bob.locator('.message-tools [data-action=react][data-emoji="❤️"]').first().click({force: true});
    await alice.waitForSelector('.reaction');
    await alice.screenshot({path: __dirname + '/browser-output/community-light.png'});
    await alice.click('#theme'); assert.equal(await alice.getAttribute('body', 'data-theme'), 'night');
    await alice.screenshot({path: __dirname + '/browser-output/community-night.png'});
    for (const p of [alice, bob]) {
      await p.locator('#channel-list button').filter({hasText: 'Sala de conversa'}).click();
      await p.click('#call-join'); await p.waitForFunction(() => !!call.channelId);
    }
    for (const p of [alice, bob]) {await p.click('#mic'); await p.click('#camera');}
    await new Promise(r=>setTimeout(r,1500));
    for(const [name,p] of [['Alice',alice],['Bob',bob]]) console.log(name+' SDP',JSON.stringify(await p.evaluate(()=>[...call.peers.values()].map(p=>({polite:p.polite,state:p.pc.connectionState,ice:p.pc.iceConnectionState,local:p.pc.localDescription?.type,remote:p.pc.remoteDescription?.type,mids:p.pc.getTransceivers().map(t=>({mid:t.mid,dir:t.currentDirection,transport:t.sender.transport?.state})),toast:document.getElementById('toast').textContent})))));
    try {await alice.waitForFunction(async () => {
      const peer = [...call.peers.values()][0]; if (!peer) return false;
      const stats = [...(await peer.pc.getStats()).values()];
      return stats.some(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.bytesReceived > 0) && stats.some(s => s.type === 'inbound-rtp' && s.kind === 'audio' && s.bytesReceived > 0);
    }, null, {timeout: 10000});} catch(e) {for(const [name,p] of [['Alice',alice],['Bob',bob]]) console.log(name,await p.evaluate(async()=>({id:call.id,local:call.media(),peers:await Promise.all([...call.peers.values()].map(async p=>({id:p.id,state:p.pc.connectionState,signal:p.pc.signalingState,ice:p.pc.iceConnectionState,mids:Object.fromEntries(Object.entries(p.senders).map(([k,v])=>[k,v.mid])),tracks:Object.keys(p.tracks),pending:p.pending.length,stats:[...(await p.pc.getStats()).values()].filter(s=>['inbound-rtp','outbound-rtp'].includes(s.type)).map(s=>({type:s.type,kind:s.kind,bytes:s.bytesReceived||s.bytesSent}))}))),toast:document.getElementById('toast').textContent})));throw e;}
    try {await bob.waitForFunction(async () => {const stats=[...(await [...call.peers.values()][0].pc.getStats()).values()];return stats.some(s=>s.type==='inbound-rtp'&&s.kind==='video'&&s.bytesReceived>0)&&stats.some(s=>s.type==='inbound-rtp'&&s.kind==='audio'&&s.bytesReceived>0);}, null, {timeout:10000});} catch(e) {console.log('Bob conexão',JSON.stringify(await bob.evaluate(async()=>await Promise.all([...call.peers.values()].map(async p=>({state:p.pc.connectionState,ice:p.pc.iceConnectionState,signal:p.pc.signalingState,transceivers:p.pc.getTransceivers().map(t=>({mid:t.mid,direction:t.currentDirection,ice:t.sender.transport?.iceTransport.state,dtls:t.sender.transport?.state,track:t.sender.track?.kind})),stats:[...(await p.pc.getStats()).values()].filter(s=>['inbound-rtp','outbound-rtp','transport'].includes(s.type)),toast:document.getElementById('toast').textContent})))),null,2));throw e;}
    const initial = await alice.evaluate(() => [...call.peers.values()].map(p => ({state: p.pc.connectionState, tracks: Object.keys(p.tracks), senders: p.pc.getSenders().length})));
    console.log('WebRTC com microfone/câmera:', JSON.stringify(initial));
    await alice.evaluate(() => {
      Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', {configurable: true, value: async () => {
        const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 360;
        const draw = () => {const c = canvas.getContext('2d'); c.fillStyle = '#65ccec'; c.fillRect(0, 0, 640, 360); c.fillStyle = '#16465a'; c.font = '30px sans-serif'; c.fillText('Screen Room • teste ' + Date.now(), 30, 180);}; draw(); setInterval(draw, 100);
        const stream = canvas.captureStream(10), audio = new AudioContext(), destination = audio.createMediaStreamDestination(), oscillator = audio.createOscillator();
        oscillator.connect(destination); oscillator.start(); stream.addTrack(destination.stream.getAudioTracks()[0]); return stream;
      }});
    });
    await alice.check('#system-audio'); await alice.click('#share');
    await bob.waitForFunction(() => [...call.peers.values()].some(p => p.media.screen && p.tracks.screen && p.tracks.screenAudio));
    await bob.waitForFunction(async () => {
      const stats = [...(await [...call.peers.values()][0].pc.getStats()).values()];
      return stats.filter(s => s.type === 'inbound-rtp' && s.kind === 'video' && s.bytesReceived > 0).length === 2;
    });
    assert.equal(await bob.locator('audio').count(), 2);
    console.log('Trilhas remotas',JSON.stringify(await alice.evaluate(()=>[...call.peers.values()].map(p=>({media:p.media,tracks:Object.fromEntries(Object.entries(p.tracks).map(([k,t])=>[k,{kind:t.kind,ready:t.readyState,muted:t.muted}]))})))));
    console.log('Vídeo recebido',JSON.stringify(await bob.evaluate(async()=>({videos:[...document.querySelectorAll('#videos video')].map(v=>({width:v.videoWidth,state:v.readyState,track:v.srcObject?.getTracks()[0]?.kind})),stats:[...(await [...call.peers.values()][0].pc.getStats()).values()].filter(s=>s.type==='inbound-rtp'&&s.kind==='video').map(s=>({bytes:s.bytesReceived,framesDecoded:s.framesDecoded,framesReceived:s.framesReceived}))}))));
    await bob.waitForFunction(()=>[...document.querySelectorAll('#videos video')].filter(v=>v.videoWidth>0).length>=3,null,{timeout:10000});
    assert.ok(await alice.evaluate(()=>[...call.peers.values()].every(p=>p.media.camera&&p.tracks.camera.kind==='video')));
    assert.ok(await bob.evaluate(()=>[...call.peers.values()].every(p=>p.media.camera&&p.tracks.camera.kind==='video'&&p.tracks.screen.kind==='video'&&p.tracks.screenAudio.kind==='audio')));
    await alice.screenshot({path: __dirname + '/browser-output/call-night.png'});
    await alice.click('#share'); await bob.waitForFunction(() => ![...call.peers.values()][0].media.screen);
    await alice.click('#camera'); await alice.click('#camera'); await bob.waitForFunction(() => [...call.peers.values()][0].media.camera);
    await alice.click('#call-leave'); await alice.waitForFunction(() => !call.channelId && Object.keys(call.local).length === 0); await bob.waitForFunction(() => call.peers.size === 0);
    await bob.click('#call-leave');
    await alice.setViewportSize({width: 390, height: 844});
    await alice.click('#nav-toggle'); await alice.locator('#channel-list button').filter({hasText: 'geral'}).click();
    await alice.screenshot({path: __dirname + '/browser-output/mobile-night.png'});
    assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await alice.setViewportSize({width: 844, height: 390});
    assert.equal(await alice.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await alice.reload(); await alice.waitForSelector('#workspace:not(.hidden)'); assert.equal(await alice.getAttribute('body', 'data-theme'), 'night');
    await alice.click('#settings'); await alice.click('#settings-logout'); await alice.waitForSelector('#auth:not(.hidden)');
    await alice.setViewportSize({width: 390, height: 844}); await alice.screenshot({path: __dirname + '/browser-output/login-mobile-night.png'});
    assert.equal(errors.length, 0, errors.join('\n'));
    console.log('PASS: UI, dois usuários, XSS, mensagens, edição, reações, temas, RTP áudio/vídeo, tela sintética, parada, reconexão e layout móvel.');
  } finally {await browser.close(); await instance.close();}
})().catch(e => {console.error(e.stack); process.exit(1);});
