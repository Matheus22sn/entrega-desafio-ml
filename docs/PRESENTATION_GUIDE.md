# Presentation Guide

## Pitch de 30 segundos

Este projeto e um painel full stack para operacao de anuncios do Mercado Livre. Ele autentica o vendedor via OAuth, sincroniza os anuncios para um cache local em MongoDB, permite filtrar, editar e criar anuncios, e adiciona validacao antes da publicacao. A entrega foi reforcada com sessao isolada por navegador, retry para erros externos, deteccao de mudanca remota e optimistic locking basico na edicao.

## Como explicar a arquitetura

Use esta ordem:

1. Frontend React/Vite para operacao do usuario.
2. Backend Express para centralizar autenticacao, integracao Mercado Livre e regras.
3. MongoDB para persistencia local e listagem com filtros.
4. Deploy em Vercel + Render + Atlas.

## Como explicar a autenticacao

Fale assim:

> Eu nao deixei a autenticacao global na instancia. O backend cria uma sessao pendente por navegador, envia isso no `state` do OAuth, e depois devolve um `session_id` para o frontend. A partir dai, toda request autenticada usa esse `session_id` e o backend resolve qual seller esta ativo naquela sessao.

## Como explicar a sincronizacao

Fale assim:

> O backend sincroniza os itens do seller, faz upsert local no Mongo e marca estados operacionais. Se um item sumiu da busca remota, ele vira `missing_remote`. Se o snapshot remoto mudou desde a ultima comparacao local, ele vira `remote_changed`.

## Como explicar a criacao

Fale assim:

> Eu quis evitar payload no chute. Entao o fluxo de criacao sugere categoria pelo titulo, consulta os listing types disponiveis para aquela conta e categoria, monta os atributos dinamicos e valida o payload antes de publicar.

## Como explicar a edicao

Fale assim:

> Na edicao eu implementei um optimistic locking basico. O frontend envia o `updatedAt` que ele abriu no modal. Se o registro local mudou antes do salvamento, o backend bloqueia a operacao com `409` e marca o item como conflito.

## O que destacar como ponto de pleno

- Separacao entre frontend, backend e integracao externa.
- Persistencia local para leitura operacional e comparacao com remoto.
- Sessao por navegador em vez de estado global.
- Retry para falha externa.
- Refresh de token.
- Sync state explicito.
- Validacao antes da publicacao.
- Controle basico de concorrencia.

## O que admitir como limitacao

Se perguntarem por limitacoes, responda sem rodeio:

### Concorrencia

> O controle de concorrencia foi implementado no fluxo de edicao rapida, mas nao existe uma estrategia completa de merge ou fila de reconciliacao.

### Sync

> A sincronizacao e on-demand. Nao existe ainda um worker dedicado ou agendamento automatico.

### Auditoria

> Eu guardo estado operacional do item, mas nao um historico completo por evento.

### Multiusuario

> O projeto saiu do estado global e passou a ter sessao por navegador, o que resolve o problema de demonstracao e isolamento basico. Para um produto multiusuario de verdade, eu evoluiria para uma camada de identidade e autorizacao mais formal.

## Roteiro de demo

### Passo 1

Mostrar a home publicada.

Falar:

> O painel mostra status da conta, metricas e a lista local dos anuncios.

### Passo 2

Clicar em autenticar/reconectar.

Falar:

> O login usa OAuth do Mercado Livre e cria uma sessao isolada para esse navegador.

### Passo 3

Sincronizar anuncios.

Falar:

> Aqui eu busco os anuncios do seller autenticado, atualizo o cache local e marco divergencias operacionais.

### Passo 4

Abrir um item para editar.

Falar:

> Essa edicao envia um marcador de versao local para evitar overwrite cego.

### Passo 5

Abrir `Novo anuncio`.

Falar:

> O fluxo nao tenta publicar no escuro. Primeiro sugere categoria, depois carrega tipos validos e atributos, valida o payload e so depois publica.

## Perguntas provaveis e respostas curtas

### "Por que MongoDB?"

> Porque o desafio pedia Mongo e ele funciona bem como cache operacional flexivel para os itens sincronizados do marketplace.

### "Por que manter cache local?"

> Para ter listagem rapida, filtros locais, persistencia e comparacao entre estado local e remoto.

### "Como voce tratou duplicidade?"

> O upsert local usa `ml_id` como chave unica do item sincronizado e o registro tambem e escopado por `seller_user_id`.

### "Como voce tratou falhas da API externa?"

> Centralizei a integracao, implementei refresh de token e retry para falhas transientes.

### "Como voce tratou concorrencia?"

> Com optimistic locking basico na edicao, usando `expected_updated_at`.

## Frase final boa para encerrar

> O foco da entrega foi sair de um CRUD simples e aproximar o projeto de um painel operacional real, com autenticacao isolada, cache local, validacao de publicacao e tratamento inicial de divergencia e concorrencia.
