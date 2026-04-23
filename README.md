# Desafio ML

Aplicacao full stack para autenticacao de vendedor, sincronizacao, criacao, edicao e gerenciamento de anuncios do Mercado Livre.

## Objetivo

Este projeto foi desenvolvido para atender ao desafio tecnico de uma vaga full stack, com foco em:

- autenticacao OAuth com Mercado Livre
- listagem local com filtros e metricas
- sincronizacao de anuncios do vendedor autenticado
- criacao de anuncios com preditor de categoria
- validacao de payload antes da publicacao
- edicao rapida de titulo, preco e estoque
- persistencia local com MongoDB
- tratamento basico de concorrencia e divergencia entre cache local e marketplace

## Links de producao

- Frontend: [https://desafio-ml.vercel.app](https://desafio-ml.vercel.app)
- Backend: [https://desafio-ml-backend.onrender.com](https://desafio-ml-backend.onrender.com)
- Healthcheck do backend: [https://desafio-ml-backend.onrender.com/api/health](https://desafio-ml-backend.onrender.com/api/health)

## Resumo funcional

O projeto foi estruturado como um painel operacional de vendedor.

Fluxos disponiveis:

- autenticar uma conta do Mercado Livre
- carregar a sessao autenticada no frontend
- sincronizar anuncios do vendedor para o banco local
- listar anuncios com busca, filtros e ordenacao
- editar titulo, preco e estoque
- criar anuncios com:
  - sugestao de categoria por titulo
  - carregamento de `listing types` da conta
  - atributos dinamicos por categoria
  - validacao previa no endpoint `POST /items/validate`

## Stack

- Frontend: React 19 + Vite + TypeScript
- Backend: Node.js + Express + TypeScript
- Banco: MongoDB
- Deploy: Vercel + Render + MongoDB Atlas

## Arquitetura

O sistema e dividido em tres camadas:

1. `frontend/`
   Responsavel pela interface do painel, autenticacao do navegador, listagem, filtros, modais de criacao/edicao e feedback visual.

2. `backend/`
   Responsavel pela autenticacao OAuth, integracao com a API do Mercado Livre, persistencia em MongoDB, normalizacao de payloads e regras de sincronizacao.

3. `MongoDB`
   Responsavel pelo cache local dos anuncios, tokens OAuth e sessoes isoladas por navegador.

## Principais decisoes tecnicas

### Sessao isolada por navegador

O projeto nao usa mais uma sessao global da aplicacao.

Cada autenticacao cria uma `AuthSession`, com:

- `session_id`
- `seller_user_id`
- `status`
- `expires_at`

O frontend armazena esse `session_id` no navegador e envia o header:

```text
x-session-id
```

Isso permite que navegadores diferentes usem contas diferentes ao mesmo tempo.

### Persistencia local

Os anuncios sincronizados e criados sao persistidos localmente em MongoDB no modelo `Ad`.

Campos importantes:

- `ml_id`
- `seller_user_id`
- `title`
- `price`
- `available_quantity`
- `status`
- `sync_state`
- `sync_note`
- `last_error`
- `last_sync`
- `remote_state_hash`

### Deteccao basica de divergencia

Na sincronizacao, o backend compara o snapshot remoto atual com o ultimo snapshot salvo e marca o item com estados operacionais:

- `synced`
- `remote_changed`
- `missing_remote`
- `conflict`

### Optimistic locking na edicao

Na edicao rapida, o frontend envia `expected_updated_at`.

Se o registro local tiver mudado antes da gravacao, o backend retorna `409` e marca o item como `conflict`.

## Estrutura do projeto

```text
backend/
  lib/
  models/
  routes/
  server.ts

frontend/
  src/
    components/
    lib/
    App.tsx

docs/
  ARCHITECTURE.md
  ENDPOINTS.md
  IMPLEMENTED_IMPROVEMENTS.md
  PRESENTATION_GUIDE.md

docker-compose.yml
render.yaml
README.md
```

## Modelos principais

### `Token`

Armazena o token OAuth por `user_id` do Mercado Livre.

Campos principais:

- `user_id`
- `access_token`
- `refresh_token`
- `expires_at`

### `AuthSession`

Armazena a sessao isolada por navegador.

Campos principais:

- `session_id`
- `seller_user_id`
- `frontend_url`
- `status`
- `expires_at`
- `last_seen_at`
- `authenticated_at`

### `Ad`

Armazena o snapshot local do anuncio remoto.

Campos principais:

- `ml_id`
- `seller_user_id`
- `title`
- `price`
- `available_quantity`
- `status`
- `sync_state`
- `sync_note`
- `last_error`
- `last_sync`
- `remote_state_hash`
- `last_remote_change_at`

## Fluxos principais

### 1. Autenticacao

1. O frontend chama `GET /api/auth/login`.
2. O backend cria uma `AuthSession` pendente.
3. O backend devolve a URL de OAuth do Mercado Livre com `state`.
4. O usuario autentica no Mercado Livre.
5. O Mercado Livre redireciona para `/api/auth/callback`.
6. O backend troca `code` por token, salva o token e ativa a sessao.
7. O usuario volta para o frontend com `session_id`.
8. O frontend passa a usar esse `session_id` nas proximas chamadas.

### 2. Sincronizacao

1. O frontend chama `POST /api/ads/sync`.
2. O backend resolve a sessao atual.
3. O backend consulta os IDs dos anuncios do vendedor.
4. O backend busca os detalhes em lotes.
5. O backend faz `upsert` no MongoDB.
6. O frontend recarrega a listagem local.

### 3. Criacao de anuncio

1. O usuario digita o titulo.
2. O frontend chama `GET /api/ads/category-predictor`.
3. O usuario escolhe a categoria sugerida.
4. O frontend chama `GET /api/ads/category-context`.
5. O frontend monta o formulario dinamico com os atributos da categoria.
6. O frontend monta um titulo efetivo enriquecido com atributos relevantes.
7. O frontend chama `POST /api/ads/validate`.
8. Se a validacao passar, chama `POST /api/ads`.
9. O backend publica no Mercado Livre e persiste localmente.

### 4. Edicao de anuncio

1. O usuario abre o modal de edicao.
2. O frontend envia titulo, preco, estoque e `expected_updated_at`.
3. O backend compara a versao local.
4. Se houver conflito, retorna `409`.
5. Se nao houver, atualiza no Mercado Livre e persiste o snapshot novo.

## Funcionalidades entregues

### Frontend

- layout de painel com metricas
- filtros por busca, status, sincronizacao e estoque
- tabela e cards responsivos
- modal de criacao
- modal de edicao
- toasts de sucesso, erro e informacao
- exibicao do status da sessao autenticada
- validacao local de regras basicas antes de chamar o backend
- titulo efetivo construido dinamicamente para melhorar publicacao

### Backend

- OAuth com Mercado Livre
- refresh automatico de token
- retry para falhas transientes
- sessao por navegador
- escopo por vendedor autenticado
- listagem local com filtros
- sincronizacao do seller autenticado
- preditor de categoria
- contexto da categoria
- validacao de payload
- criacao e edicao de anuncio

## Endpoints principais

### Auth

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/status`
- `GET /api/auth/me`
- `DELETE /api/auth/session`

### Ads

- `GET /api/ads`
- `POST /api/ads/sync`
- `GET /api/ads/category-predictor?title=...`
- `GET /api/ads/category-context?category_id=...`
- `GET /api/ads/listing-types?category_id=...`
- `POST /api/ads/validate`
- `POST /api/ads`
- `PUT /api/ads/:id`

## Variaveis de ambiente

### Backend

Crie `backend/.env` a partir de [backend/.env.example](/Z:/desafio-ml/backend/.env.example).

```env
PORT=3000
MONGO_URI=mongodb://localhost:27017/desafio_ml
ML_APP_ID=your_mercado_livre_app_id
ML_SECRET_KEY=your_mercado_livre_secret
ML_REDIRECT_URI=http://localhost:3000/api/auth/callback
FRONTEND_URL=http://localhost:5173
CORS_ORIGIN=http://localhost:5173
```

### Frontend

Crie `frontend/.env` a partir de [frontend/.env.example](/Z:/desafio-ml/frontend/.env.example).

```env
VITE_API_URL=http://localhost:3000/api
```

## Execucao local

### 1. Subir MongoDB

```bash
docker compose up -d
```

### 2. Rodar backend

```bash
cd backend
npm install
npm run dev
```

Backend local:

```text
http://localhost:3000
```

### 3. Rodar frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend local:

```text
http://localhost:5173
```

## Scripts disponiveis

### Backend

- `npm run dev`
- `npm run build`
- `npm run start`
- `npm run typecheck`

### Frontend

- `npm run dev`
- `npm run build`
- `npm run lint`
- `npm run preview`

## Como testar localmente

### Teste minimo

1. Abrir frontend.
2. Clicar em `Reconectar conta`.
3. Autorizar no Mercado Livre.
4. Confirmar se o card de sessao mostra os dados da conta autenticada.
5. Sincronizar anuncios.
6. Criar um anuncio validando antes da publicacao.

### Teste de isolamento de sessao

1. Abra o app no navegador normal.
2. Autentique uma conta.
3. Abra uma janela anonima.
4. Autentique outra conta.
5. Confirme que cada navegador mostra uma sessao diferente.

## Como o avaliador pode testar

O avaliador pode autenticar a propria conta, desde que:

- a aplicacao do Mercado Livre esteja ativa
- a `redirect_uri` cadastrada esteja correta
- a conta dele tenha permissao para anunciar

Fluxo esperado:

1. acessar o frontend publicado
2. clicar em `Reconectar conta`
3. autenticar no Mercado Livre com a conta propria
4. voltar ao frontend
5. sincronizar, validar e testar criacao/edicao

## Observacoes importantes sobre Mercado Livre

### 1. Regras de categoria sao dinamicas

Os atributos obrigatorios mudam por categoria e podem mudar ao longo do tempo.  
Por isso o projeto consulta os atributos em tempo real antes da validacao/publicacao.

### 2. GTIN pode ser obrigatorio

Em varias categorias, `GTIN` pode ser exigido de verdade.

Mesmo que a categoria exponha `EMPTY_GTIN_REASON`, a API pode continuar exigindo GTIN real dependendo da categoria, da marca, da conta ou da politica aplicada.

### 3. Conta pode ter restricoes de publicacao

Durante os testes reais, a conta autenticada retornou erros como:

- `seller.unable_to_list`
- `restrictions_coliving`
- `At least one policy returned UNAUTHORIZED`

Esses erros sao restricoes da conta/politica do Mercado Livre e nao necessariamente erros do codigo do projeto.

### 4. Test users sao recomendados

Para testes controlados, o ideal e usar usuarios de teste do Mercado Livre em vez de contas pessoais.

Referencia oficial:
- [Realizacao de testes](https://developers.mercadolivre.com.br/pt_br/produto-consulta-de-usuarios/realizacao-de-testes)

## Deploy

### Frontend

O frontend esta preparado para Vercel.

Arquivo:
- [frontend/vercel.json](/Z:/desafio-ml/frontend/vercel.json)

Variavel principal:

```env
VITE_API_URL=https://SEU_BACKEND.onrender.com/api
```

### Backend

O backend esta preparado para Render.

Arquivo:
- [render.yaml](/Z:/desafio-ml/render.yaml)

Variaveis principais:

- `MONGO_URI`
- `ML_APP_ID`
- `ML_SECRET_KEY`
- `ML_REDIRECT_URI`
- `FRONTEND_URL`
- `CORS_ORIGIN`

### Callback do Mercado Livre

A `redirect_uri` configurada no painel da app do Mercado Livre deve ser exatamente:

```text
https://SEU_BACKEND.onrender.com/api/auth/callback
```

## Limitacoes conhecidas

- o controle de concorrencia e basico e focado em edicao rapida
- a sincronizacao usa persistencia local, mas nao usa fila ou scheduler dedicado
- o comportamento de publicacao depende de politicas da conta do Mercado Livre
- categorias diferentes podem exigir GTIN, atributos extras e regras especificas
- servicos gratuitos do Render podem entrar em idle

## Melhorias futuras

- fila assincrona de sincronizacao
- historico e auditoria de mudancas
- reconciliacao mais robusta entre cache local e marketplace
- suporte a multiplas contas no mesmo frontend com selecao explicita
- testes automatizados de integracao

## Documentacao complementar

- [Arquitetura](./docs/ARCHITECTURE.md)
- [Endpoints](./docs/ENDPOINTS.md)
- [Melhorias implementadas](./docs/IMPLEMENTED_IMPROVEMENTS.md)
- [Guia de apresentacao](./docs/PRESENTATION_GUIDE.md)

## Observacao sobre o repositorio de entrega

Para envio ao avaliador, e recomendavel usar um repositorio final limpo, separado do repositorio de trabalho.

Motivos:

- evita expor historico de debugging e commits intermediarios
- facilita a leitura do codigo
- melhora a apresentacao da entrega
- reduz ruido para quem esta avaliando

Estrategia recomendada:

1. manter este repositorio como historico de desenvolvimento
2. criar um novo repositorio final, por exemplo `entrega-desafio-ml`
3. subir apenas o estado final limpo, sem historico antigo irrelevante

## Checklist antes do envio

1. revisar `.gitignore`
2. garantir que `.env` nao esta versionado
3. garantir que `node_modules` e `dist` nao estao versionados
4. validar frontend e backend em producao
5. confirmar URLs publicas no README
6. revisar `.env.example`
7. autenticar uma conta e validar ao menos um fluxo completo
