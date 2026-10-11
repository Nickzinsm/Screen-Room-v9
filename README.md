# Screen Room v9

Comunidades, chat, DMs e chamadas P2P com os temas Frutiger Aero claro/Night. Um único servidor Node.js pronto para GitHub → Render.

Comece por [LEIA-PRIMEIRO.md](LEIA-PRIMEIRO.md). Render: `npm ci --omit=dev` → `npm start`, Node 24.x, plano Free, `/health`.

Sem `DATABASE_URL`, os dados no Render são temporários e se perdem em reinícios. PostgreSQL externo e backup estão disponíveis. Não é a implementação completa do Fluxer.

Localmente: `npm ci`, `npm start`, http://localhost:3000. Testes: `npm test`.
