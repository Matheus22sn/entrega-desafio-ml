# Frontend do Desafio ML

Aplicacao React + Vite para autenticar o vendedor, sincronizar anuncios locais, criar novos itens e editar preco/estoque.

## Rodando localmente

1. Copie `.env.example` para `.env`.
2. Ajuste `VITE_API_URL` para a URL do backend.
3. Instale as dependencias com `npm install`.
4. Rode `npm run dev`.

## Variaveis de ambiente

- `VITE_API_URL`: base da API do backend. Exemplo: `http://localhost:3000/api`

## Fluxo principal

- Autenticar a conta do vendedor.
- Sincronizar anuncios do Mercado Livre com o MongoDB local.
- Filtrar anuncios por busca, status, sincronizacao, estoque e ordenacao.
- Criar um novo anuncio pelo modal.
- Editar preco e estoque diretamente no painel.
