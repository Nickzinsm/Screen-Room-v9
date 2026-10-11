# Android — salas por código

Este é o cliente Java nativo do Screen Room v7 reaproveitado para o protocolo de salas temporárias do v9. Não implementa as contas, comunidades e conversas novas. Não há APK compilado neste ZIP.

1. Instale Android Studio, JDK 17 e Android SDK 35.
2. Abra a pasta `android/` como projeto Gradle. Ela inclui a configuração Gradle, mas não o executável do wrapper; se necessário, configure Gradle 8.10.2 no IDE ou gere o wrapper com uma instalação Gradle local.
3. Aguarde o sincronismo das dependências.
4. Use **Build → Build APK(s)** para uma compilação de teste. A assinatura de produção precisa de uma chave própria.
5. Instale o APK de teste no celular. Informe a URL HTTPS do seu serviço Render, seu nome e um código de sala.
6. No PC, abra `https://seu-servico.onrender.com/salas.html`, informe o mesmo código e entre.
7. No Android, use o botão de transmissão e autorize a captura do sistema.

A recepção e captura em Android 14/15/16, permissões/serviço em primeiro plano, conexão entre redes e encerramento de captura ainda exigem teste real. O cliente original transmite vídeo da tela, sem captura nativa do áudio interno e sem a configuração TURN opcional do cliente web. Não interprete estas instruções como uma confirmação de build ou funcionamento em aparelho.

Compartilhe códigos somente com os participantes desejados: salas por código são públicas a quem conhece o código, sem controle de acesso pelas contas v9.
