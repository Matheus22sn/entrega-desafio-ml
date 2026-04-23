# Architecture

## Objetivo

Este documento explica como a aplicacao funciona por dentro para que voce consiga descrever a arquitetura sem depender do codigo aberto na hora da entrevista.

## Visao de alto nivel

O sistema e dividido em 3 blocos:

1. Frontend React/Vite
2. Backend Express/Node
3. MongoDB como persistencia local

O backend integra com a API do Mercado Livre e o frontend consome apenas a API propria do projeto.

## Componentes do frontend

### `App.tsx`

Componente raiz do painel. Concentra:

- carregamento de sessao autenticada
- carregamento da listagem local
- sincronizacao
- abertura dos modais
- filtros e metricas
- toasts de feedback

### `AdCreateModal.tsx`

Responsavel pelo fluxo completo de publicacao:

- digitar titulo
- sugerir categoria
- carregar contexto da categoria
- montar atributos dinamicos
- validar payload
- publicar

### `AdEditModal.tsx`

Responsavel pela edicao rapida de:

- titulo
- preco
- estoque

Esse modal envia `expected_updated_at` para habilitar optimistic locking basico.

### `StatusBadge.tsx`

Padroniza exibicao de:

- status do anuncio
- status de sincronizacao

### `ToastStack.tsx`

Centraliza feedback de:

- sucesso
- erro
- informacao

## Componentes do backend

### `server.ts`

Ponto de entrada da API.

Responsabilidades:

- inicializar Express
- configurar CORS
- conectar no MongoDB
- registrar rotas
- expor `/api/health`

### `routes/auth.ts`

Responsavel pela autenticacao OAuth.

Endpoints:

- `GET /api/auth/login`
- `GET /api/auth/callback`
- `GET /api/auth/status`
- `GET /api/auth/me`
- `DELETE /api/auth/session`

### `routes/Ads.ts`

Responsavel por:

- listar cache local
- sincronizar com marketplace
- sugerir categoria
- carregar contexto da categoria
- validar payload
- criar anuncio
- atualizar anuncio

### `lib/mercadoLibre.ts`

Camada de integracao externa.

Responsabilidades:

- trocar `code` por token
- refresh token
- executar requests autenticadas
- retry para falhas transientes
- serializar/deserializar `state` do OAuth
- montar redirect de volta ao frontend

### `lib/session.ts`

Camada de sessao isolada por navegador.

Responsabilidades:

- criar sessao pendente
- ativar sessao apos callback OAuth
- ler `x-session-id`
- validar sessao
- destruir sessao

## Modelagem

### `Token`

Armazena o token OAuth por `user_id`.

Uso:

- o token e a identidade real do vendedor autenticado
- a sessao referencia o vendedor por `seller_user_id`

### `AuthSession`

Armazena a sessao do navegador.

Motivacao:

- evita sessao global da aplicacao
- isola cada browser/tab/logon
- permite que cada usuario tenha seu proprio contexto

Fluxo:

- criada como `pending` no `/auth/login`
- ativada como `authenticated` no `/auth/callback`
- expirada por TTL

### `Ad`

Cache local do anuncio remoto.

Campos importantes:

- `seller_user_id`: garante escopo por vendedor
- `sync_state`: estado operacional do item
- `sync_note`: explica divergencia
- `last_error`: guarda erro mais recente
- `remote_state_hash`: snapshot resumido do estado remoto
- `last_remote_change_at`: quando uma mudanca remota foi detectada

## Fluxo de autenticacao

### 1. Inicio no frontend

O frontend chama:

```text
GET /api/auth/login?frontend_url=https://...
```

### 2. Sessao pendente

O backend cria uma `AuthSession` pendente com `session_id`.

### 3. OAuth state

O `state` enviado ao Mercado Livre leva:

- `frontendUrl`
- `sessionId`

### 4. Callback

O Mercado Livre redireciona para:

```text
/api/auth/callback?code=...&state=...
```

O backend:

- troca `code` por token
- salva/atualiza `Token`
- ativa `AuthSession`
- redireciona ao frontend com `session_id`

### 5. Sessao no frontend

O frontend grava `session_id` e envia esse valor no header:

```text
x-session-id
```

## Fluxo de listagem

1. Front chama `GET /api/ads`.
2. Backend resolve a sessao atual.
3. O backend busca apenas anuncios com `seller_user_id` daquele browser.
4. O backend aplica filtros e ordenacao no Mongo.
5. O frontend renderiza tabela e cards responsivos.

## Fluxo de sincronizacao

1. Front chama `POST /api/ads/sync`.
2. Backend resolve a sessao.
3. Backend carrega o token do seller correto.
4. Backend chama `/users/{id}/items/search`.
5. Backend carrega detalhes via `/items`.
6. Cada item remoto vira um upsert local.
7. O backend gera `remote_state_hash`.
8. Se o hash mudou em relacao ao ultimo snapshot salvo, o item vira `remote_changed`.
9. Itens que sumiram da busca passam a `missing_remote`.

## Fluxo de criacao

### Preditor de categoria

Frontend chama:

```text
GET /api/ads/category-predictor?title=...
```

### Contexto da categoria

Depois chama:

```text
GET /api/ads/category-context?category_id=...
```

Esse endpoint devolve:

- dados da categoria
- listing types validos para o seller
- atributos obrigatorios/opcionais

### Validacao

Antes da publicacao, o frontend chama:

```text
POST /api/ads/validate
```

### Publicacao

Se o payload estiver valido:

```text
POST /api/ads
```

Depois da resposta remota, o backend persiste o item localmente.

## Fluxo de edicao

O frontend manda:

- novo titulo
- novo preco
- novo estoque
- `expected_updated_at`

O backend compara esse valor com o `updatedAt` atual do documento local.

### Se houve mudanca no meio da edicao

- retorna `409`
- marca o item como `conflict`
- grava mensagem em `last_error` / `sync_note`

### Se nao houve mudanca

- atualiza no Mercado Livre
- busca snapshot novo do item
- persiste localmente como `synced`

## Estados de sincronizacao

### `synced`

O registro local bate com o ultimo snapshot remoto conhecido.

### `remote_changed`

O item no marketplace mudou desde o ultimo snapshot salvo localmente.

### `missing_remote`

O item nao apareceu na busca de itens do seller durante a ultima sincronizacao.

### `conflict`

Uma atualizacao local foi bloqueada porque o registro mudou antes de salvar.

## Tratamento de falhas externas

O backend usa retry para erros transientes, especialmente:

- timeout
- `429`
- `500`
- `502`
- `503`
- `504`

Tambem existe refresh automatico de token quando a API externa responde `401`.

## Decisoes tecnicas

### Por que sessao via `session_id` e nao estado global?

Porque o projeto inicial estava single-tenant. Isso era fraco para avaliacao pleno e fazia qualquer browser compartilhar a mesma conta.

### Por que optimistic locking basico?

Porque era a forma mais direta de cobrir o requisito de concorrencia sem introduzir uma fila complexa ou uma camada de eventos.

### Por que cache local no Mongo?

Porque o desafio pede persistencia, filtros e consistencia ao longo do tempo. O cache local permite:

- listagem rapida
- filtros sem depender da API externa
- comparacao entre estado local e remoto

## Limitacoes atuais

- Nao existe fila assincrona para sincronizacao pesada.
- Conflito e reconciliacao ainda sao basicos.
- Nao ha auditoria completa de historico por alteracao.
- Nao existe RBAC ou multiusuario de organizacao, apenas isolamento por browser session.
