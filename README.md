# Integração API e ERP

API de pedidos com Node.js 24, TypeScript, Fastify e PostgreSQL.
Inclui idempotência, controle de concorrência e ERP simulado com recuperação de falhas.

## Pré-requisitos

- Node.js 24 e npm.
- PostgreSQL em execução, com `psql` no PATH e um usuário com permissão para criar bancos.

Execute os comandos abaixo na raiz do projeto. Os exemplos usam PostgreSQL
em `localhost:5432` com usuário `postgres`; ajuste conforme seu ambiente.

## 1. Instalar e configurar

```bash
npm ci
```

Copie `.env.example` para `.env` e preencha `DB_HOST`, `DB_PORT`, `DB_NAME`,
`DB_USER` e `DB_PASSWORD`. Para desenvolvimento, use `DB_NAME=api_erp`.

Use dados fictícios e mantenha os arquivos de credenciais fora do Git.

## 2. Criar o banco e as tabelas

Execute uma única vez, para um banco novo:

```bash
psql -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE api_erp;"
psql -h localhost -p 5432 -U postgres -d api_erp -v ON_ERROR_STOP=1 -f sql/001_create_orders.sql
```

Se o banco já existe, pule o primeiro comando. A migration deve ser aplicada
somente em um banco vazio; esta versão não possui gerenciador de migrations.
O `psql` solicitará a senha do usuário, se necessário.

No Windows, se `psql` não estiver no PATH, substitua `psql` pelo caminho da sua
instalação, por exemplo: `& "C:\Program Files\PostgreSQL\18\bin\psql.exe"` no PowerShell.

## 3. Executar

```bash
npm run dev
```

A API estará em `http://127.0.0.1:3000`. Consulte `/health` para verificar a API
e `/ready` para verificar a conexão com o banco.

Para executar a versão compilada:

```bash
npm run build
npm start
```

## 4. Executar os testes

Copie `.env.example` para `.env.test`, preencha as credenciais e altere
`DB_NAME` para `api_erp_test`.

Crie o banco de testes e aplique a migration uma única vez:

```bash
psql -h localhost -p 5432 -U postgres -d postgres -v ON_ERROR_STOP=1 -c "CREATE DATABASE api_erp_test;"
psql -h localhost -p 5432 -U postgres -d api_erp_test -v ON_ERROR_STOP=1 -f sql/001_create_orders.sql
```

Se o banco já existe, pule sua criação. Depois da configuração, execute:

```bash
npm test
```

Os 12 testes usam PostgreSQL real e exigem o banco `api_erp_test`.
Não é necessário iniciar a API: as requisições usam `app.inject`.
Ao terminar, os testes removem somente os registros criados pela execução.

## 5. Demonstrar o fluxo

Com a API rodando, execute em outro terminal:

```bash
npm run demo
```

A demonstração cria um pedido fictício, repete a criação com a mesma chave,
simula timeout após o aceite pelo ERP, reconcilia e consulta o histórico.
Cada execução utiliza uma chave nova.

## Documentação técnica

- [Referência da API](docs/api.md): endpoints, exemplos e respostas HTTP.
- [Arquitetura e decisões](docs/arquitetura.md): idempotência, concorrência,
  tratamento de falhas, rastreabilidade, cobertura de testes e limitações.

A solução foi preparada para demonstração local. O ERP é simulado;
autenticação, autorização e retentativas automáticas são propostas para produção,
conforme detalhado na documentação de arquitetura.
