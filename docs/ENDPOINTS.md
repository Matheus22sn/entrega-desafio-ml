# Endpoints

## Convencoes

- Base local: `http://localhost:3000/api`
- Base publicada: `https://SEU-BACKEND.onrender.com/api`
- Sessao do browser: header `x-session-id`

## Auth

### `GET /auth/login`

Gera a URL de OAuth do Mercado Livre e cria uma sessao pendente.

#### Query params

- `frontend_url`: origem do frontend que deve receber o redirect final

#### Resposta

```json
{
  "url": "https://auth.mercadolivre.com.br/authorization?..."
}
```

### `GET /auth/callback`

Recebe o retorno do Mercado Livre.

#### Query params

- `code`
- `state`

#### Comportamento

- troca `code` por token
- ativa a sessao
- redireciona ao frontend com:
  - `auth=success`
  - `session_id=...`

Em erro:

- `auth=error`
- `message=...`

### `GET /auth/status`

Valida a sessao do navegador e devolve o seller autenticado.

#### Header

- `x-session-id`

#### Resposta autenticada

```json
{
  "authenticated": true,
  "session_id": "uuid",
  "expires_at": "2026-04-23T20:00:00.000Z",
  "seller": {
    "id": 123,
    "nickname": "SELLER",
    "email": "seller@email.com",
    "user_type": "normal",
    "points": 10
  }
}
```

#### Resposta sem sessao

```json
{
  "authenticated": false
}
```

### `GET /auth/me`

Devolve o perfil do seller atual.

### `DELETE /auth/session`

Remove a sessao atual do navegador.

## Ads

### `GET /ads`

Lista o cache local de anuncios do seller da sessao atual.

#### Query params

- `search`
- `status`
- `sync_state`
- `stock`
- `sort`

#### Resposta

```json
{
  "items": [],
  "summary": {
    "total": 0,
    "active": 0,
    "paused": 0,
    "lowStock": 0,
    "unsynced": 0,
    "conflicts": 0,
    "remoteChanged": 0,
    "inventoryValue": 0
  }
}
```

### `POST /ads/sync`

Sincroniza os anuncios do seller autenticado.

#### Header

- `x-session-id`

#### Resposta

```json
{
  "items": [],
  "warnings": [],
  "syncedAt": "2026-04-23T20:00:00.000Z",
  "summary": {
    "total": 0,
    "active": 0,
    "paused": 0,
    "lowStock": 0,
    "unsynced": 0,
    "conflicts": 0,
    "remoteChanged": 0,
    "inventoryValue": 0
  }
}
```

### `GET /ads/category-predictor`

Preditor de categoria a partir do titulo.

#### Query params

- `title`

#### Resposta

```json
{
  "items": [
    {
      "category_id": "MLB1652",
      "category_name": "Notebooks",
      "domain_id": "MLB-NOTEBOOKS",
      "domain_name": "Notebooks"
    }
  ]
}
```

### `GET /ads/category-context`

Carrega contexto da categoria para publicacao.

#### Query params

- `category_id`

#### Header

- `x-session-id`

#### Resposta

```json
{
  "category": {
    "id": "MLB1652",
    "name": "Notebooks",
    "path_from_root": []
  },
  "listingTypes": [],
  "attributes": []
}
```

### `GET /ads/listing-types`

Carrega os listing types validos para a categoria e seller atual.

#### Query params

- `category_id`

#### Header

- `x-session-id`

### `POST /ads/validate`

Valida o payload antes da publicacao.

#### Header

- `x-session-id`

#### Body

```json
{
  "title": "Notebook Dell Inspiron",
  "category_id": "MLB1652",
  "listing_type_id": "gold_pro",
  "price": 3500,
  "available_quantity": 3,
  "condition": "new",
  "currency_id": "BRL",
  "buying_mode": "buy_it_now",
  "pictures": ["https://..."],
  "attributes": [
    { "id": "BRAND", "value_name": "Dell" }
  ]
}
```

#### Resposta valida

```json
{
  "valid": true,
  "status": "ok",
  "issues": []
}
```

#### Resposta invalida

```json
{
  "valid": false,
  "error": "Validation error",
  "issues": []
}
```

### `POST /ads`

Publica um anuncio e persiste o registro local.

#### Header

- `x-session-id`

#### Body

Mesmo contrato do `/ads/validate`.

### `PUT /ads/:id`

Atualiza um anuncio existente.

#### Header

- `x-session-id`

#### Body

```json
{
  "title": "Novo titulo",
  "price": 4200,
  "available_quantity": 5,
  "expected_updated_at": "2026-04-23T20:00:00.000Z"
}
```

#### Possiveis respostas

- `200`: atualizacao feita
- `400`: payload invalido
- `401`: sessao nao autenticada
- `404`: anuncio nao encontrado para aquele seller
- `409`: conflito por concorrencia otimista

## Erros padrao

A API devolve erros no formato:

```json
{
  "error": "Mensagem principal",
  "details": {}
}
```
