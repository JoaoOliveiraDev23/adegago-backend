# AdegaGo — Backend (Firebase)

Este repositório contém a **infraestrutura** do AdegaGo: regras de segurança do banco de dados, configuração
de hospedagem e de emuladores, testes das regras e scripts de apoio. O AdegaGo é um catálogo digital para
consulta de produtos, preços, categorias, disponibilidade e promoções de adegas e pequenos estabelecimentos
de bebidas (Projeto Integrador universitário).

> **Não há servidor próprio.** O "backend" é composto por serviços gerenciados do Firebase, usados
> diretamente pelo frontend por meio do SDK oficial. Este repositório guarda tudo o que **configura e protege**
> esses serviços. O custo é zero, pois tudo funciona no plano gratuito **Spark** (sem cartão de crédito).

## Sumário

1. [Arquitetura](#1-arquitetura)
2. [Relação entre os dois repositórios](#2-relação-entre-os-dois-repositórios)
3. [Tecnologias](#3-tecnologias)
4. [Pré-requisitos](#4-pré-requisitos)
5. [Estrutura deste repositório](#5-estrutura-deste-repositório)
6. [Modelo de dados (Firestore)](#6-modelo-de-dados-firestore)
7. [Autenticação e criação do administrador](#7-autenticação-e-criação-do-administrador)
8. [Regras de segurança](#8-regras-de-segurança)
9. [Execução local com emuladores](#9-execução-local-com-emuladores)
10. [Testes](#10-testes)
11. [Configuração do Firebase real](#11-configuração-do-firebase-real)
12. [Publicação](#12-publicação)
13. [Limites do plano gratuito e acompanhamento do consumo](#13-limites-do-plano-gratuito-e-acompanhamento-do-consumo)
14. [Requisitos acadêmicos](#14-requisitos-acadêmicos)
15. [Limitações conhecidas](#15-limitações-conhecidas)

---

## 1. Arquitetura

```
                          Navegador do usuário
                  ┌──────────────────────────────────┐
                  │  Frontend React (adegago-frontend)│
                  │  usa o SDK oficial do Firebase    │
                  └───────┬──────────────┬────────────┘
        baixa o site      │              │  lê/grava dados (Firestore)
        (HTML/JS/CSS)     │              │  entra/sai (Authentication)
                          ▼              ▼
              ┌──────────────┐   ┌─────────────────────────────┐
              │   Firebase   │   │ Cloud Firestore  +  Firebase │
              │   Hosting    │   │ Authentication               │
              └──────────────┘   │                              │
                                 │  ▲ Security Rules decidem o  │
                                 │  │ que cada pessoa pode fazer│
                                 └──┴──────────────────────────┘
```

| Serviço | Para que serve no AdegaGo |
| --- | --- |
| **Firebase Hosting** | Publica o frontend (arquivos gerados por `npm run build`). |
| **Cloud Firestore** | Guarda os produtos de forma permanente (coleção `produtos`) e a lista de administradores (`admins`). |
| **Firebase Authentication** | Faz o login do administrador com e-mail e senha. |
| **Security Rules** | Regras que ficam **dentro do Firestore** e decidem quem pode ler e escrever. É a proteção real dos dados. |
| **Emulator Suite** | Simula Firestore, Authentication e Hosting no seu computador, para testar sem tocar no serviço real. |

**Ideia central de segurança:** o código do frontend roda no navegador e pode ser alterado por qualquer
pessoa; por isso, esconder telas no React **não protege nada**. Quem protege os dados são as
**Security Rules**, que o Google executa no servidor a cada leitura/escrita.

## 2. Relação entre os dois repositórios

| Repositório | Conteúdo |
| --- | --- |
| **`adegago-frontend`** | Aplicação React (telas, componentes, serviços que chamam o SDK do Firebase). Gera a pasta `dist/`. |
| **`adegago-backend`** (este) | `firestore.rules`, `firebase.json`, testes das regras, scripts do emulador, dados de exemplo e esta documentação. |

Os dois devem ficar **lado a lado**, na mesma pasta:

```
projeto-integrador/
├── adegago-frontend/
└── adegago-backend/
```

Motivo: o `firebase.json` deste repositório publica o conteúdo de `../adegago-frontend/dist`. Fluxo de
publicação: gerar o build no frontend → publicar a partir do backend (seção 12).

Não existe um servidor HTTP intermediário: o frontend conversa direto com o Firebase.

## 3. Tecnologias

Firebase Hosting, Cloud Firestore, Firebase Authentication (e-mail e senha), Firestore Security Rules,
Firebase Emulator Suite, Firebase CLI (`firebase-tools`), `@firebase/rules-unit-testing` e o executor de
testes nativo do Node (`node --test`). Nada de Cloud Functions, Cloud Run, Cloud Storage ou serviços pagos.

## 4. Pré-requisitos

| Ferramenta | Versão | Observação |
| --- | --- | --- |
| Node.js | 20.19 ou superior (ou 22.12+) | `node -v` |
| Java (JDK) | **21 ou superior** | Necessário **apenas** para o emulador do Firestore (`java -version`). |
| Git | qualquer recente | Controle de versão. |
| Conta Google | — | Só para o Firebase real (seção 11). Para usar emuladores não é preciso conta. |

## 5. Estrutura deste repositório

```
adegago-backend/
├── firebase.json              # Hosting (publica ../adegago-frontend/dist), regras e emuladores
├── .firebaserc                # Projeto padrão: "demo-adegago" (só emulador; veja a seção 12)
├── firestore.rules            # Regras de segurança do Firestore  ← parte mais importante
├── package.json               # Scripts (emuladores, testes, publicação)
├── seed/produtos.json         # 12 produtos de exemplo (os mesmos dados fictícios do frontend original)
├── scripts/preparar-emulador.mjs   # Cria admin de teste + produtos de exemplo NO EMULADOR
└── tests/regras.test.js       # Testes das Security Rules
```

Não é necessário um `firestore.indexes.json`: o catálogo usa uma consulta por um único campo
(`orderBy('createdAt')`), e o Firestore cria esse índice automaticamente.

## 6. Modelo de dados (Firestore)

### Coleção `produtos` (ID do documento gerado automaticamente)

| Campo | Tipo | Obrigatório | Regra |
| --- | --- | --- | --- |
| `nome` | string | sim | 2 a 80 caracteres |
| `descricao` | string | sim | 1 a 240 caracteres |
| `categoria` | string | sim | 2 a 40 caracteres |
| `preco` | number | sim | maior que 0, até 99.999,99, **no máximo 2 casas decimais** |
| `disponivel` | boolean | sim | `true` = Disponível / `false` = Indisponível (informado à mão pelo administrador) |
| `precoPromocional` | number | não | se existir: preço válido e **menor** que `preco` |
| `imagem` | string | não | endereço `http(s)://…` ou caminho iniciado por `/`, sem espaços, até 500 caracteres |
| `createdAt` | timestamp | sim | definido pelo **servidor** na criação; não pode mudar depois |
| `updatedAt` | timestamp | sim | renovado pelo **servidor** a cada edição |

Decisões de modelagem (e por quê):

- **`emPromocao` não é gravado.** O frontend deriva `emPromocao = (precoPromocional existe)`. Guardar os dois
  criaria redundância e a chance de ficarem contraditórios. As regras até **rejeitam** o campo `emPromocao`.
- **Campo opcional ausente = "não tem".** Sem promoção, o campo `precoPromocional` simplesmente não existe
  (o frontend usa `deleteField()` para removê-lo). Não se grava `null`.
- **Preços são números** (não texto), validados com até duas casas decimais.
- **`id`** é o ID do documento; o serviço do frontend o converte para o campo `id` que a interface espera.
- **Categorias** são uma lista fixa no frontend (`src/data/categorias.js`), não uma coleção: nenhuma
  coleção extra foi criada sem necessidade. As regras só exigem que a categoria seja um texto de 2 a 40
  caracteres.

### Coleção `admins` (criada manualmente)

Um documento por administrador, com **ID = UID** da conta no Authentication. O conteúdo é livre (sugestão:
`papel` = `"admin"`); o que vale é a **existência** do documento. Ver seção 7.

## 7. Autenticação e criação do administrador

O login usa **Firebase Authentication com e-mail e senha**. O frontend:

- faz login e logout; a sessão fica salva no navegador e é restaurada ao reabrir o site;
- observa a sessão: se ela expirar ou for encerrada, volta para a tela de login;
- após o login, consulta `admins/{uid}`; se o documento não existir, a pessoa é desconectada
  ("Esta conta não tem permissão de administrador");
- **não tem tela de cadastro**: administradores só nascem pelo procedimento abaixo.

> Esse documento serve só para o app saber **o que mostrar**. A permissão de verdade é verificada de novo
> pelas Security Rules em toda gravação.

### Criar o primeiro administrador (procedimento controlado)

Feito **uma vez**, no **Console do Firebase** (https://console.firebase.google.com), com o projeto já criado
e o Authentication configurado (seção 11):

1. **Authentication → Usuários → Adicionar usuário.** Informe o e-mail e uma senha forte (mínimo 6
   caracteres; prefira uma longa) e confirme.
2. Na lista de usuários, **copie o "UID do usuário"** (código longo, ex.: `k3J9xQ...`).
3. **Firestore Database → Dados → "Iniciar coleção"** (ou "Adicionar coleção").
   - ID da coleção: `admins`
   - ID do documento: **cole o UID** copiado (exatamente, sem espaços).
   - Campo: nome `papel`, tipo `string`, valor `admin`. Salve.
4. Abra o site publicado, vá em **Área administrativa** e entre com o e-mail e a senha criados.

Para **revogar** um administrador: exclua o documento `admins/{uid}` (e, se quiser, a conta no
Authentication). A permissão deixa de valer imediatamente nas regras.

Boas práticas (resumo):

- Nunca coloque e-mail/senha de administrador no código, no `.env` ou no Git.
- Use uma senha exclusiva e longa; ative a verificação em duas etapas na **sua conta Google** (dona do projeto).
- **Cadastro por terceiros:** como a chave de API do Firebase é pública, é tecnicamente possível alguém criar
  uma conta de e-mail/senha direto pela API do Authentication. Essa conta **não ganha nenhum privilégio** (não
  tem `admins/{uid}`, e ninguém consegue criá-lo pelo app), mas ocupa espaço na lista de usuários. Se o seu
  Console oferecer a opção de desativar o cadastro de novos usuários (em *Authentication → Configurações →
  Ações do usuário*), vale desativá-la, pois administradores continuam sendo criados pelo Console.
  Não confirmei se essa opção aparece em todos os projetos; confira no seu.
- **Não ative** o upgrade opcional "Authentication com Identity Platform": ele altera os limites do plano gratuito.

## 8. Regras de segurança

Arquivo: [`firestore.rules`](firestore.rules). Tudo o que não está liberado é **negado por padrão**.

| Quem | Produtos | Admins |
| --- | --- | --- |
| Visitante (sem login) | **ler** | nada |
| Usuário logado comum | **ler** | ler **apenas o próprio** documento (que não existe) |
| Administrador (`admins/{uid}` existe) | ler, **criar, editar, excluir** (com dados válidos) | ler **apenas o próprio** documento |
| Qualquer pessoa, pelo app | — | **ninguém** lista, cria, edita ou exclui |
| Qualquer outra coleção | negado | — |

O que as regras validam em **criar/editar**: só campos conhecidos (`hasOnly`); campos obrigatórios presentes
(`hasAll`); tipos (`string`, `number`, `bool`, `timestamp`); tamanhos; preço > 0, ≤ 99.999,99 e com 2 casas
decimais; promocional menor que o preço; imagem como endereço seguro; `createdAt`/`updatedAt` vindos do servidor
(`request.time`), `createdAt` imutável.

Decisões que merecem atenção (para a defesa do projeto):

- **Administrador é lido do próprio banco** (`exists(admins/{uid})`), sem Cloud Functions (que exigiriam plano
  pago). Cada verificação conta **1 leitura** da cota gratuita; é desprezível neste projeto.
- **`allow get` no próprio `admins/{uid}`.** O enunciado pede que usuários comuns não consigam consultar
  documentos administrativos. Para o app saber se quem entrou é admin, o usuário precisa conseguir ler **o seu
  próprio** documento: se ele não for admin, a resposta é apenas "não existe" (nada vaza). Ler o documento
  de **outra pessoa**, listar a coleção ou escrever nela é sempre negado — por isso ninguém consegue
  conceder privilégio a si mesmo.
- **Datas do servidor:** o cliente não consegue falsificar `createdAt`/`updatedAt`.
- **Leitura pública** (`allow read: if true`) é intencional (catálogo sem login). O analisador de regras do
  Firebase emite um *aviso* por isso; é esperado.

## 9. Execução local com emuladores

Os emuladores simulam os serviços no seu computador. **Nada do que você fizer aqui afeta o Firebase real**
(o projeto `demo-adegago` não existe na nuvem).

**Terminal 1 — emuladores** (`adegago-backend`):

```bash
npm install
npm run emuladores            # Authentication (9099) + Firestore (8080) + painel em http://127.0.0.1:4000
```

**Terminal 2 — dados de teste** (`adegago-backend`), com **e-mail e senha de teste à sua escolha**:

```bash
# Linux / macOS
ADMIN_EMAIL=admin@teste.com ADMIN_SENHA=senha-de-teste npm run emuladores:dados

# Windows (PowerShell)
$env:ADMIN_EMAIL="admin@teste.com"; $env:ADMIN_SENHA="senha-de-teste"; npm run emuladores:dados
```

O script cria o usuário no Authentication (emulador), o documento `admins/{uid}` e os 12 produtos de exemplo
(gravados como administrador, então também passam pelas regras). Nenhuma senha fica no código.

**Terminal 3 — frontend** (`adegago-frontend`):

```bash
npm install
npm run dev:emulador          # http://localhost:5173, ligado aos emuladores
```

Entre em `/admin/login` com o e-mail/senha definidos acima. Os dados do emulador somem ao encerrá-lo (para
guardá-los: `npx firebase emulators:start --only auth,firestore --project demo-adegago --import=./emulator-data
--export-on-exit`).

## 10. Testes

### Testes das regras de segurança (obrigatório)

```bash
npm install
npm test
```

O comando inicia o emulador do Firestore, executa [`tests/regras.test.js`](tests/regras.test.js) e encerra o
emulador. Os testes usam o emulador **de verdade**, ou seja, verificam as **regras**, não só a aparência do
frontend. São **87 testes em 11 grupos**, que cobrem:

- consulta pública, produto inexistente e usuário comum lendo produtos;
- escrita **sem login** e por usuário logado **sem** `admins/{uid}` (criar, editar e excluir: tudo negado);
- administrador: criar (mínimo, com promoção e imagem), editar, alterar só a disponibilidade, remover promoção
  (`deleteField`) e excluir;
- campos obrigatórios (um teste por campo), campos inesperados (inclusive `emPromocao`);
- tipos e limites de nome, descrição, categoria e disponibilidade;
- preços (negativo, zero, texto, nulo, 3 casas decimais, acima do máximo; e os válidos);
- promoções (igual/maior/negativa/zero/texto/nula/3 casas; e redução do preço abaixo do promocional existente);
- imagem (válidas e inválidas, incluindo `javascript:`);
- datas do servidor (cliente não pode enviar nem alterar `createdAt`/`updatedAt`);
- proteção de `admins` (ler o próprio, não ler o de outro, não listar, **não se auto-promover**, nem o admin
  cria/edita/exclui) e coleções desconhecidas.

> **Na primeira execução**, o Firebase CLI baixa o emulador do Firestore (≈ 130 MB); é preciso internet e Java 21+.

### Registro de execução (preencha na sua máquina)

| Item | Resultado |
| --- | --- |
| Data / máquina / versões (`node -v`, `java -version`) | |
| `npm test` — total de testes / aprovados / falhas | |
| Observações | |

### O que foi verificado no momento da entrega

Para evitar afirmações indevidas, eis o que **foi e o que não foi** executado durante o desenvolvimento:

| Verificação | Situação |
| --- | --- |
| Sintaxe de `firestore.rules` com o analisador oficial (`@firebase/eslint-plugin-security-rules`) | **Executada: 0 erros** (1 aviso esperado: leitura pública). Com controle negativo (regra quebrada de propósito foi detectada). |
| Fórmula numérica da regra de preço (2 casas decimais) para os 9.999.999 valores de R$ 0,01 a R$ 99.999,99 | **Executada: 0 valores válidos rejeitados**; valores inválidos recusados. |
| `firebase.json` + **Hosting** no emulador oficial (caminho `../adegago-frontend/dist`, rotas do React, cabeçalhos) | **Executada: aprovada.** |
| `tests/regras.test.js` (regras contra o emulador do Firestore) | **NÃO executada:** o ambiente de desenvolvimento não conseguiu baixar o emulador do Firestore (`storage.googleapis.com` bloqueado). O código dos testes foi escrito e teve a sintaxe e os imports conferidos, mas **precisa ser executado por você** (`npm test`). |
| Integração frontend ↔ serviços (16 cenários, com um Firebase *simulado* em memória que espelha as regras) | **Executada: 16/16.** Valida o que o frontend envia e como as telas reagem; **não** substitui o teste das regras reais. |

Se algum teste falhar na sua máquina, ele aponta exatamente qual regra se comporta diferente do esperado.

## 11. Configuração do Firebase real

Só é necessária para publicar. Use uma conta Google pessoal. Nenhuma etapa pede cartão de crédito.

1. **Criar o projeto:** https://console.firebase.google.com → *Criar um projeto* → nome (ex.: `adegago`).
   Anote o **ID do projeto** (ex.: `adegago-1a2b3`). Pode desativar o Google Analytics (não é usado).
   **Mantenha o plano Spark** (não clique em *Upgrade*/*Blaze*).
2. **Registrar o app da Web:** na página inicial do projeto, ícone **`</>`** (Web) → apelido (ex.: `adegago-web`).
   **Não** marque "Firebase Hosting" nesta tela (a configuração já existe neste repositório). Copie os 4 valores
   do objeto `firebaseConfig`: `apiKey`, `authDomain`, `projectId`, `appId`. Eles vão para o `.env` do
   frontend (seção 12). São identificadores públicos, não senhas.
3. **Firestore:** *Criação → Firestore Database → Criar banco de dados*: edição **Standard**, banco `(default)`,
   escolha a localização (ex.: `southamerica-east1` — São Paulo; **não pode ser alterada depois**), modo de
   **produção** (as regras reais são publicadas na seção 12).
4. **Authentication:** *Criação → Authentication → Começar → Método de login → E-mail/senha → Ativar*
   (deixe "Link por e-mail" desativado).
5. **Administrador:** siga a seção 7 (criar usuário e `admins/{uid}`).
6. **Regras e Hosting:** são publicados pela linha de comando (seção 12). Não há nada para fazer no Console.

## 12. Publicação

> Esta etapa **altera o serviço real**. Execute apenas quando estiver pronto(a).

**1. Configurar o frontend** (`adegago-frontend`): copie `.env.example` para `.env` e preencha os 4 valores da
etapa 2 da seção 11 (mantenha `VITE_USE_FIREBASE_EMULATORS=false`).

```bash
cd adegago-frontend
npm install
npm run build        # gera a pasta dist/
```

**2. Entrar no Firebase e publicar** (`adegago-backend`):

```bash
cd ../adegago-backend
npm install
npx firebase login                          # abre o navegador; use a conta dona do projeto

# Substitua SEU_ID_DO_PROJETO pelo ID anotado na seção 11
npx firebase deploy --only firestore:rules,hosting --project SEU_ID_DO_PROJETO
```

O comando exibe a **URL do site** (`https://SEU_ID.web.app`). Opcional: `npx firebase use --add` associa o
projeto ao `.firebaserc` para você poder usar `npm run deploy` sem o `--project`.

> O `.firebaserc` vem com o projeto `demo-adegago` de propósito: assim, um `firebase deploy` esquecido sem
> `--project` **falha**, em vez de publicar no lugar errado.

**3. Conferir:** abra a URL → o catálogo aparece (vazio no começo) → entre em *Área administrativa* → cadastre
produtos. Os produtos do `seed/produtos.json` **não** são enviados ao Firebase real (o script é só do emulador);
cadastre os produtos reais pela própria interface.

**Atualizar depois:** repita `npm run build` (frontend) e o `deploy`. Para mudar só as regras:
`npx firebase deploy --only firestore:rules --project SEU_ID`.

## 13. Limites do plano gratuito e acompanhamento do consumo

Valores do plano **Spark** conferidos na documentação/preços oficiais do Firebase em novembro/2026.
Confirme sempre na página oficial de preços, pois podem mudar.

| Serviço | Limite gratuito (Spark) | Observação |
| --- | --- | --- |
| Firestore | 1 GiB armazenados; **50 mil leituras/dia**; 20 mil escritas/dia; 20 mil exclusões/dia | Só o banco `(default)` |
| Hosting | 10 GB armazenados; **360 MB/dia** de transferência | Domínio próprio e SSL incluídos |
| Authentication (e-mail/senha) | Gratuito | Sem o upgrade Identity Platform |
| Cloud Storage | **Não incluído no Spark** (exige Blaze desde fev/2026) | Por isso as imagens são **endereços (URL)**, sem upload |

**O Spark não gera cobrança:** ao atingir uma cota, o serviço apenas **para de responder até a renovação**
(a cota diária é renovada aproximadamente à meia-noite do horário do Pacífico). Para nunca pagar: **não faça
upgrade para Blaze** e não vincule cartão.

Estimativas de ordem de grandeza (para dimensionar, não são garantias):

- Cada abertura do catálogo lê **todos** os produtos: 12 produtos = 12 leituras → cerca de 4.000 acessos/dia.
  Com 100 produtos, cerca de 500 acessos/dia. Cada gravação do administrador consome também 1 leitura extra
  (verificação em `admins`).
- O frontend gerado tem ≈ 270 KB compactados; no primeiro acesso de cada pessoa isso conta na transferência
  (360 MB/dia ≈ 1.300 primeiros acessos/dia). Depois, os arquivos ficam em cache no navegador.

**Como acompanhar:** no Console do Firebase, aba **Uso** de cada produto (*Firestore Database → Uso*,
*Hosting → Uso*, *Authentication → Uso*) e, para cotas detalhadas, *Google Cloud Console → IAM e administrador →
Cotas*.

## 14. Requisitos acadêmicos

| Requisito | Como é atendido | Evidências para apresentar | Ressalvas |
| --- | --- | --- | --- |
| Desenvolvimento web | Aplicação React/Vite publicada no Firebase Hosting | URL pública; repositório `adegago-frontend` | — |
| JavaScript | Frontend em JS/JSX; testes e scripts em JS | Código-fonte | — |
| Banco de dados | **Cloud Firestore** (banco de documentos NoSQL): coleções `produtos` e `admins`, modelo da seção 6, regras de validação | Console do Firestore com os dados; seção 6; `firestore.rules` | Se a disciplina exigir banco **relacional/SQL**, o Firestore não atende e é preciso alinhar com o professor. |
| Serviços em nuvem | Hosting + Firestore + Authentication, no plano gratuito | Console do Firebase (projeto, uso); URL do site | — |
| Integração com API ou serviço de persistência | O frontend usa o **SDK oficial do Firebase**, que se comunica com o serviço de banco de dados na nuvem do Google | Código de `src/services/produtosService.js` e `authService.js`; dados persistindo após recarregar a página | **Ver nota abaixo.** |
| Acessibilidade | HTML semântico, foco, rótulos, contraste, `aria-*` (etapa anterior); verificação automatizada com axe-core (simulação em jsdom): 0 violações em 8 estados de tela na etapa anterior e, reexecutada após a integração com o Firebase, 0 violações em 4 (catálogo, login, painel e formulário com erros) | Documentação do frontend; relatório axe | Verificação com leitor de tela e teclado em navegador real **não foi feita**. |
| Controle de versão | Dois repositórios Git independentes | Histórico de *commits* | Os *commits* precisam ser feitos por você. |
| Testes | Suíte das regras de segurança com Emulator Suite (87 testes) | Saída do `npm test` | **Execução pendente** (seção 10): preencha o registro. |

**Nota sobre "API":** o SDK do Firebase é uma biblioteca; por baixo, ela chama a **API do Cloud Firestore**
(um serviço de API do Google, com protocolo documentado). Tecnicamente há uma API, mas **não é uma API
desenvolvida por você**. Se o requisito da universidade for "o grupo deve desenvolver uma API própria"
(por exemplo, REST em Node.js), o uso direto do SDK **pode não ser aceito**, e essa decisão cabe ao professor:
**confirme antes de entregar**. Possíveis argumentos/evidências a levar: (a) o Firestore também expõe uma API
REST pública, que pode ser demonstrada porque a leitura de `produtos` é pública
(`GET https://firestore.googleapis.com/v1/projects/SEU_ID/databases/(default)/documents/produtos` — não testei
no seu projeto); (b) a regra de negócio e a segurança foram implementadas como regras declarativas. Caso uma
API própria seja obrigatória, as alternativas seriam Cloud Functions/Cloud Run, que **exigem o plano Blaze**
(com cartão), fora do que foi definido para este projeto.

## 15. Limitações conhecidas

- **Testes das regras ainda não executados** no ambiente de desenvolvimento (seção 10).
- **Só produtos criados pelo app/script aparecem no catálogo:** a listagem ordena por `createdAt`; um
  documento criado à mão no Console, sem esse campo, não é listado.
- **Cota de leitura pública:** como o catálogo é aberto, qualquer pessoa pode consumir a cota gratuita diária
  (50 mil leituras); se isso acontecer, o catálogo fica indisponível até a renovação. O **App Check** (gratuito)
  reduz esse risco, mas **não foi implementado**, para manter o escopo simples.
- **Cache do `index.html`:** o Hosting aplica o cache padrão (cerca de 1 hora) ao HTML; logo após uma nova
  publicação, alguém com a versão antiga em cache pode ver o site desatualizado por um tempo.
- **Escrita sem internet:** o Firestore, sem conexão, "enfileira" gravações; o frontend recusa a operação antes
  (offline) ou após 15 s sem resposta, mas, nesse último caso, a gravação pode ser aplicada depois, quando a
  conexão voltar. Recarregue a lista para conferir.
- **Imagens por URL:** sem upload de arquivos (exigiria Cloud Storage, que não é gratuito).
- **Um único administrador** é o cenário previsto (nada impede vários, mas não há tela para gerenciá-los).
- **Categorias** fixas no código do frontend.
- Dependências de desenvolvimento do Firebase CLI reportam avisos no `npm audit`; elas não fazem parte do
  que é publicado.
