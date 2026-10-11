# Screen Room v9 — Aero • GitHub → Render

Esta edição volta ao servidor único Node.js do Screen Room. A aparência mantém os temas Frutiger Aero claro e Night; a organização em comunidades, canais e conversas é inspirada no Fluxer. **Não é a base completa do Fluxer nem uma promessa de todas as suas funcionalidades.**

Não precisa de Docker, domínio comprado, DuckDNS, abertura de portas ou PC ligado. O Render entrega uma URL HTTPS `https://nome.onrender.com`.

## Publicar pelo GitHub e Render

1. Extraia o ZIP. Abra a pasta que contém `package.json`, `package-lock.json`, `server.js` e `render.yaml`.
2. Crie um repositório novo no GitHub, por exemplo `screen-room-v9`. Envie **os arquivos extraídos**, e não o ZIP. `package.json` precisa aparecer na raiz do repositório. Não envie `node_modules`, `data`, backups ou `.env`.
3. No Render, use **New → Web Service**, conecte o GitHub e escolha esse repositório.
4. Preencha:

   | Campo | Valor |
   | --- | --- |
   | Language / Runtime | Node |
   | Branch | main, ou a branch que contém o projeto |
   | Root Directory | deixe vazio se os arquivos estão na raiz |
   | Build Command | `npm ci --omit=dev` |
   | Start Command | `npm start` |
   | Instance Type | Free |
   | Health Check Path | `/health` |

5. Crie o serviço e aguarde o deploy. Abra a URL `.onrender.com` que o Render mostrar.
6. Crie a primeira conta imediatamente: ela será administradora da instância. Crie uma comunidade e use **Convidar amigos**. Compartilhe o link com seus amigos.

Alternativa: **New → Blueprint**, escolha o repositório e utilize o `render.yaml` incluído. Ele cria somente um Web Service gratuito, sem banco pago, disco ou outros serviços.

O runtime está fixado em Node **24.x**, com lockfile npm. Se atualizar um serviço antigo, confira os comandos e o runtime no painel; as configurações de um serviço existente podem continuar usando `yarn` ou Docker. Um repositório e serviço novos evitam misturar os arquivos enormes do v8 com os do v9. Não use o Dockerfile nem o Compose do v8 neste projeto.

## Contas e mensagens no plano gratuito

**Sem banco externo, o deploy no Render funciona em modo temporário.** Reinícios, novos deploys e suspensão por inatividade apagam as contas, comunidades, mensagens e convites. O aviso aparece no login e na aplicação; não existe promessa de armazenamento permanente nesse modo.

O administrador pode abrir **Configurações → Baixar backup da instância**. Para recuperar após um reinício, crie uma conta inicial temporária, use **Restaurar backup** e entre com o usuário e a senha que existiam no backup. O arquivo inclui hashes de senha e todas as conversas privadas da instância: guarde-o em um lugar privado. Sessões e chamadas não são restauradas.

### Preservar os dados com um banco gratuito externo

O projeto já aceita PostgreSQL através de `DATABASE_URL`; cria sua tabela automaticamente. Uma opção é o plano Free do [Neon](https://neon.com/), sujeito às cotas e condições do fornecedor.

1. Crie uma conta no Neon e um projeto no plano **Free**.
2. No painel, abra **Connect** e copie a URL PostgreSQL completa, incluindo a senha e os parâmetros de TLS fornecidos. Não envie essa URL a outras pessoas.
3. No Render, abra seu serviço → **Environment → Add Environment Variable**.
4. Defina o nome `DATABASE_URL` e cole a URL como valor, sem aspas adicionais.
5. Salve e faça o redeploy. A aplicação inicia com armazenamento em banco, e o aviso de modo temporário desaparece.
6. Se já havia dados temporários, baixe o backup **antes** do redeploy e restaure-o depois. Adicionar a variável não migra a memória do processo antigo.

Não coloque credenciais em arquivos do GitHub. Não há painel SQL ou migração manual obrigatória. Essa edição escreve um estado JSON limitado em uma tabela e foi feita para **uma única instância e comunidades pequenas**, não para vários servidores ou milhares de participantes. O acesso a um banco externo pode contar nas cotas do Render e do fornecedor. Confira os limites antes de ampliar o uso.

Documentação consultada em 11/10/2026:
- [Render gratuito: suspensão por inatividade e disco efêmero](https://render.com/docs/free)
- [Deploy Node/Express](https://render.com/docs/deploy-node-express-app)
- [Neon Free: condições atuais](https://neon.com/blog/neon-free-plan-1-gb-per-project)

## Funcionalidades desta edição

- Cadastro e login com senha, perfil e sessão por cookie HttpOnly. Não usa contas do Fluxer.
- Comunidades privadas acessadas por convite de sete dias.
- Canais de texto e de voz, com criação/exclusão por moderadores.
- Conversas privadas entre duas contas que compartilham uma comunidade.
- Mensagens em tempo real, histórico paginado, respostas, edição, exclusão, cinco reações e fixação por moderadores.
- Presença online e indicador de digitação.
- Cargos fixos: proprietário, moderador e membro. Remoção e banimento. Não há cargos personalizados ou painel de desbanimento nesta edição.
- Chamadas P2P em canais de voz e DMs: microfone, câmera, compartilhamento de tela do PC e tela cheia. Até seis participantes por padrão.
- Temas Aero claro/Night, interface responsiva em retrato/paisagem, instalação PWA.
- Salas públicas temporárias por código, com o protocolo antigo em `/signal`, disponíveis em `/salas.html`.
- Backup e restauração pelo administrador da instância; PostgreSQL opcional.

Não inclui upload de arquivos, stickers personalizados, GIFs externos, bots, webhooks, threads, SSO, e-mail de recuperação, gravação, notificações push de mensagens ou a infraestrutura SFU/LiveKit do Fluxer. A busca filtra as mensagens que foram carregadas no canal. Mensagens não têm criptografia ponta a ponta; o administrador/operador com acesso ao banco ou backup consegue lê-las.

## Chamadas e transmissão

O Render sinaliza a chamada via WebSocket; áudio e vídeo vão **diretamente entre os participantes**. Não é necessário publicar portas de mídia no Render. Internet, upload e desempenho de cada aparelho determinam a qualidade; não há garantia de zero atraso ou 4K para todos. Uma chamada com vários participantes exige mais upload do transmissor.

STUN é configurado por padrão. Algumas redes corporativas, móveis ou com NAT restritivo precisam de **TURN externo** para a mídia conectar. Não existe um TURN próprio hospedado no Render nem garantia de chamadas em qualquer rede no modo gratuito. Configure `ICE_SERVERS_JSON`, se tiver um provedor TURN, com a lista de servidores STUN/TURN exigida pelo navegador. Credenciais TURN estáticas são enviadas aos clientes que as utilizam; prefira credenciais restritas e não use senhas de administração do provedor. O cliente Android legado só usa os STUN originais, sem essa configuração TURN opcional.

O microfone entra desligado. Câmera e tela usam trilhas separadas. **Áudio da tela fica desligado por padrão** para reduzir eco ao compartilhar a própria chamada; ative apenas quando necessário e prefira uma aba. Captura de áudio do sistema depende do navegador e sistema operacional.

Quando o servidor reinicia ou uma conexão cai, a interface reconecta o chat, libera a captura local e pede para entrar novamente na chamada. Não use serviços de ping para tentar contornar a suspensão do Render gratuito; o projeto não inclui esse mecanismo.

## Android

O navegador/PWA Android pode acessar o chat, câmera e microfone, conforme suas permissões. Instalar a PWA não habilita captura da tela do celular.

A pasta `android/` contém o cliente nativo baseado no v7, compatível **apenas com as salas públicas por código**, não com login, comunidades ou canais v9. Informe no app a URL HTTPS do Render e use no PC `/salas.html` com o mesmo código. Não use esse cliente com os canais privados v9.

Leia `README-ANDROID.md`. Não há APK pronto neste pacote; o código Android não foi compilado nem validado em aparelho nesta entrega. Dois problemas estáticos de Java do original foram corrigidos: import não utilizado de uma classe ausente e iteração do JSONArray.

## Rodar no PC (opcional)

Com Node 24 instalado, abra um terminal na raiz:

```powershell
npm ci
npm start
```

Abra `http://localhost:3000`. Para Windows também há `iniciar-windows.cmd`. Localmente, os dados ficam em `data/state.json`. Nenhum programa de contêiner é necessário.

O Node não carrega `.env` automaticamente neste projeto. Para testar uma configuração local opcional com o arquivo `.env`, use `node --env-file=.env server.js`; no Render utilize as variáveis do painel.

## Limites e validação

Até 500 contas, 100 comunidades no total (10 por proprietário), 50 canais por comunidade, 100 membros por comunidade, 20 mil mensagens na instância e 16 MB no estado/backup. São limites desta edição simples, além das cotas de hospedagem. Excluir canais antigos remove suas mensagens; exporte antes se quiser preservá-las.

Leia `VALIDACAO.md` para distinguir testes executados de verificações que ainda precisam ser feitas no seu ambiente. O pacote está preparado para deploy; **não foi publicado automaticamente na sua conta GitHub ou Render**.
