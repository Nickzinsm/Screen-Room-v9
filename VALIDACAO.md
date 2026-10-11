# Validação — Screen Room v9

Verificações executadas em 11/10/2026, Node 24.19.0 e Chromium 153 headless. A entrega é o pacote de código preparado para deploy, não uma instância já publicada.

## Executado

- Nove testes de integração HTTP/WebSocket, em `test/server.test.js`: cadastro/login/logout e senha com hash; origem externa; comunidades privadas e convites; cargos/banimento; chat em tempo real, respostas, edição, exclusão, reações e fixação; isolamento de DMs; sinalização de chamadas; encerramento após banimento; salas legadas e limpeza ao trocar de sala; backup/validação de restauração/invalidação de sessões; persistência local e reversão de uma gravação que falha; manifesto e exclusão da API no cache PWA.
- Teste de navegador com dois contextos e duas contas reais da aplicação: criação e entrada por convite, mensagens/edição/reação recebidas pelo outro usuário, renderização de texto malicioso sem executar HTML, alternância/persistência do tema, login/logout e layout em retrato/paisagem.
- Chamadas reais WebRTC entre esses dois contextos locais, com microfone/câmera sintéticos do Chromium: quatro transceivers por conexão, SDP/ICE negociados, conexão estabelecida, recepção e decodificação de vídeo remoto. A configuração de teste libera candidatos loopback, necessária no ambiente de teste isolado; não altera a aplicação entregue.
- Tela sintética produzida por canvas e trilha de áudio por oscilador, substituindo apenas `getDisplayMedia` no teste. Confirmadas câmera e tela remotas em elementos distintos, com dimensões de vídeo maiores que zero; duas fontes de áudio remotas separadas. Testados parar tela, alternar câmera e encerrar chamada liberando as trilhas locais.
- Inspeção visual do login e da comunidade em claro/Night, chamada e telas móveis; sem transbordamento horizontal nas dimensões verificadas (390×844 e 844×390).
- Sintaxe JavaScript e instalação por lockfile. `npm audit --omit=dev`: zero vulnerabilidades conhecidas reportadas na execução. Isso não é uma auditoria completa de segurança.
- Instalação limpa de produção a partir do ZIP (`npm ci --omit=dev`), startup com o modo Render, resposta de `/health`, configuração temporária e página inicial. YAML do Blueprint lido e conferido: um único serviço Node no plano Free e versão Node 24.
- Conferência dos arquivos e CRC do ZIP final; exclusão de dados, senhas, módulos instalados e saídas de testes.

## Limites das verificações

- Não houve deploy em uma conta Render/GitHub do usuário. É necessário executar os passos de `LEIA-PRIMEIRO.md` e conferir a URL pública e os logs.
- Não houve conexão a um banco PostgreSQL externo real. O adaptador e suas consultas estão incluídos; criação da tabela, TLS e persistência do fornecedor precisam ser confirmados ao configurar `DATABASE_URL`. A persistência de arquivo local e backup foram testados.
- As chamadas foram entre contextos locais em um único ambiente. NAT/CGNAT, TURN, redes móveis/corporativas, desempenho de seis participantes e áudio/eco perceptível precisam de teste entre dispositivos reais.
- A seleção nativa de tela/janela/aba pelo sistema operacional não foi executada; o teste de tela usa captura sintética. Captura de áudio do sistema, FPS e resolução dependem do aparelho e navegador.
- PWA: manifesto, shell, registro e exclusão de API do cache foram conferidos. Instalação pelo sistema e atualizações a partir de uma PWA v7 já instalada precisam de teste em dispositivo real.
- Android: fonte do cliente legado incluída; correções estáticas de Java realizadas, mas sem compilação de APK e sem teste em aparelho. Ele atende somente às salas por código.

## Reproduzir

```sh
npm ci
npm test
```

Para os testes de navegador, com as dependências de desenvolvimento instaladas:

```sh
npx playwright install chromium
npm run test:browser
```

Em Linux, o navegador pode exigir bibliotecas adicionais (`npx playwright install --with-deps chromium` no ambiente de teste). `CHROMIUM_PATH` permite fornecer um Chromium local. As imagens de teste são geradas em `test/browser-output`, não enviadas ao GitHub.

Os testes de mídia usam aparelhos sintéticos e são evidência da negociação, fluxo e reprodução locais. Não substituem uma chamada real entre PC e celular, nem provam qualidade ou ausência de atraso em outras redes.
