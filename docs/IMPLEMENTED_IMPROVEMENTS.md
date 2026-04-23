# Implemented Improvements

## Objetivo

Este documento lista, de forma direta, tudo o que foi melhorado no projeto em relacao a um prototipo inicial.

## Backend

### Sessao por navegador

Antes:

- o backend usava o token mais recente salvo no banco
- qualquer usuario no mesmo deploy via a mesma conta conectada

Agora:

- existe uma `AuthSession` isolada por navegador
- o frontend recebe um `session_id`
- cada request autenticada usa `x-session-id`
- `status`, `sync`, `create`, `validate` e `update` passam a respeitar essa sessao

### Escopo por vendedor

Antes:

- o cache local nao era explicitamente segmentado por seller

Agora:

- cada anuncio tem `seller_user_id`
- a listagem local so retorna anuncios do seller da sessao atual

### Retry em falhas externas

Agora o backend tenta novamente em erros transientes:

- timeout
- `408`
- `409`
- `429`
- `500`
- `502`
- `503`
- `504`

### Refresh de token

Ja existia, mas agora foi preservado no fluxo por seller/session correto.

### Sync state mais explicito

Foi consolidado o uso de:

- `synced`
- `remote_changed`
- `missing_remote`
- `conflict`

### Snapshot remoto

Agora cada anuncio guarda:

- `remote_state_hash`
- `last_remote_change_at`

Isso permite detectar quando o item do marketplace mudou desde o ultimo snapshot local.

### Conflito de edicao

Agora a atualizacao usa optimistic locking basico:

- frontend envia `expected_updated_at`
- backend compara com `updatedAt`
- se a versao local mudou, retorna `409`
- o item e marcado como `conflict`

## Frontend

### Painel refeito

Foram adicionados:

- hero com status da conta
- metricas
- filtros reais
- tabela + cards responsivos
- toasts
- modal de criacao
- modal de edicao

### Sessao isolada no cliente

O frontend agora:

- armazena `session_id`
- injeta `x-session-id` nas requests
- permite encerrar sessao sem afetar outras

### Fluxo de publicacao

Foi implementado:

- preditor de categoria
- carga de listing types
- atributos dinamicos
- validacao do payload
- exibicao de erros retornados pelo Mercado Livre

### Fluxo de edicao

Foi reforcado com:

- envio de `expected_updated_at`
- reload da lista ao detectar conflito

### Estados de divergencia mais visiveis

Agora o front mostra:

- badges para `remote_changed` e `conflict`
- `sync_note` e `last_error` no item
- metrica de conflitos

## Documentacao

Foram criados/reestruturados:

- `README.md`
- `docs/ARCHITECTURE.md`
- `docs/ENDPOINTS.md`
- `docs/PRESENTATION_GUIDE.md`
- este arquivo

## Entrega / operacao

Tambem foi melhorado:

- configuracao por ambiente
- deploy em frontend + backend
- suporte a validacao antes da publicacao
- preparo para repositorio final limpo

## O que continua simples

Mesmo com as melhorias, alguns pontos continuam intencionalmente enxutos:

- nao existe fila assincrona de jobs
- nao existe historico completo de auditoria por anuncio
- nao existe reconciliacao multi-etapas com merge automatico
- nao existe multiusuario corporativo; o isolamento e por browser session
