# Integração API e ERP

API para receber pedidos de venda, persistir seu estado e simular
a integração com um ERP corporativo.

## Tecnologias

- Node.js 24
- TypeScript
- Fastify
- PostgreSQL
- Executor de testes nativo do Node.js

## Requisitos

- Node.js 24
- PostgreSQL em execução
- Bancos `api_erp` e `api_erp_test`

Docker não é necessário.

## Instalação

```bash
npm ci
```

Copie `.env.example` para `.env` e preencha as configurações locais:

```dotenv
DB_HOST=localhost
DB_PORT=5432
DB_NAME=api_erp
DB_USER=postgres
DB_PASSWORD=
```

Não versione arquivos com senhas.

## Banco de dados

Execute a migration no banco de desenvolvimento:

```bash
psql -h localhost -p 5432 -U postgres -d api_erp -v ON_ERROR_STOP=1 -f sql/001_create_orders.sql
```

No Windows, se `psql` não estiver no PATH:

```powershell
& "C:\Program Files\PostgreSQL\18\bin\psql.exe" -h localhost -p 5432 -U postgres -d api_erp -v ON_ERROR_STOP=1 -f .\sql\001_create_orders.sql
```

A migration deve ser executada uma única vez em cada banco vazio.
Não há um gerenciador automático de migrations nesta versão.

## Execução

Desenvolvimento:

```bash
npm run dev
```

Compilar e executar:

```bash
npm run build
npm start
```

A API escuta em `http://127.0.0.1:3000`.

## Endpoints

| Método | Rota | Função |
|---|---|---|
| GET | `/health` | Verifica se a API está ativa |
| GET | `/ready` | Verifica a conexão com o banco |
| POST | `/pedidos` | Valida e persiste um pedido |
| GET | `/pedidos/:id` | Consulta estado e tentativas |
| POST | `/pedidos/:id/processar` | Processa ou reconcilia um pedido |

### Criar pedido

Envie o cabeçalho `Idempotency-Key` com uma chave estável para
a mesma operação de negócio.

```http
POST /pedidos
Content-Type: application/json
Idempotency-Key: pedido-001
```

```json
{
  "cliente_id": "cliente-001",
  "itens": [
    {
      "produto_id": "produto-001",
      "quantidade": 2,
      "preco_unitario_centavos": 1500
    }
  ]
}
```

Os preços são representados em centavos inteiros.

Respostas:

- `201`: pedido criado.
- `200`: mesma chave e mesmo conteúdo; retorna o pedido existente.
- `400`: entrada inválida.
- `409`: chave já utilizada com conteúdo diferente.

A criação persiste o pedido como `pendente`.
O processamento é acionado separadamente.

### Processar pedido

```http
POST /pedidos/{id}/processar
Content-Type: application/json
```

```json
{
  "cenario": "sucesso"
}
```

Cenários disponíveis:

- `sucesso`
- `erro_transitorio`
- `erro_permanente`
- `timeout_apos_processar`

O campo `cenario` controla exclusivamente o simulador do desafio.

O endpoint retorna `200` quando registra o resultado da tentativa,
inclusive quando o resultado de negócio é uma falha. Consulte o
campo `status` da resposta.

Outras respostas:

- `400`: entrada inválida.
- `404`: pedido não encontrado.
- `409`: conflito de processamento ou estado que não permite nova tentativa.

## Arquitetura

- `src/app.ts`: configuração da aplicação e tratamento de erros.
- `src/server.ts`: inicialização e encerramento.
- `src/db.ts`: pool de conexões PostgreSQL.
- `src/routes/pedidos.ts`: endpoints e validação.
- `src/services/processar-pedido.ts`: processamento e transações.
- `src/services/erp.ts`: ERP simulado.
- `sql/`: estrutura do banco.
- `tests/`: testes de integração com PostgreSQL real.

A solução mantém o fluxo explícito e usa o PostgreSQL para
persistência e controle de concorrência, sem fila ou cache.

## Idempotência

A coluna `chave_id` possui uma restrição única no PostgreSQL.

A criação usa `INSERT ... ON CONFLICT DO NOTHING`. Isso evita que
requisições simultâneas com a mesma chave criem múltiplos pedidos.

Um hash SHA-256 do conteúdo normalizado permite detectar o uso da
mesma chave com dados diferentes.

A ordem das propriedades JSON não altera o hash, pois o objeto é
reconstruído em ordem fixa. A ordem dos itens do pedido faz parte
do conteúdo e altera o hash.

A garantia depende de o cliente reutilizar a mesma chave.
Chaves diferentes podem criar pedidos com conteúdo idêntico.

## Concorrência no processamento

O processamento utiliza `SELECT ... FOR UPDATE NOWAIT` dentro
de uma transação.

Enquanto uma operação mantém a trava, outra chamada para o mesmo
pedido recebe `409`. Após a conclusão, novas chamadas retornam o
resultado existente sem criar outra tentativa.

A numeração de tentativas é calculada enquanto a trava do pedido
está ativa e possui uma restrição única por pedido.

## Estados e recuperação

| Resultado | Estado do pedido | Recuperação |
|---|---|---|
| Sucesso | `concluido` | Não envia novamente |
| Falha transitória | `aguardando_retentativa` | Nova chamada manual |
| Rejeição permanente | `falhou` | Bloqueia nova tentativa |
| Timeout após aceite | `resultado_desconhecido` | Consulta o ERP |

Na reconciliação, se o simulador confirmar o aceite, o pedido é
concluído sem reenvio. Se não houver confirmação, o estado
desconhecido é mantido.

Não há retentativas automáticas ou agendamento nesta versão.
A coluna `proxima_tentativa_em` está reservada para uma evolução.

## Rastreabilidade e segurança

Cada tentativa registra número, resultado, código de erro e horários.

A consulta do pedido retorna seu estado e histórico, sem incluir
o conteúdo completo ou a chave de idempotência.

Os logs de processamento incluem o identificador do pedido.
Falhas internas retornam uma mensagem genérica com o identificador
da requisição, sem expor mensagens brutas do banco.

Autenticação e autorização não foram implementadas.
Use somente dados fictícios e execução local.

## Testes

Crie `.env.test` com as mesmas variáveis do `.env`, mas utilizando:

```dotenv
DB_NAME=api_erp_test
```

Execute a migration também nesse banco vazio:

```bash
psql -h localhost -p 5432 -U postgres -d api_erp_test -v ON_ERROR_STOP=1 -f sql/001_create_orders.sql
```

Execute:

```bash
npm test
```

Os testes exigem `api_erp_test` e removem apenas os registros
criados pela execução. Não é necessário iniciar o servidor HTTP:
as requisições são feitas com `app.inject`.

Os 12 testes cobrem:

- Criação de pedido válido.
- Rejeição de pedido sem itens.
- Rejeição de requisição sem chave.
- Repetição com mesma chave e conteúdo.
- Conflito de conteúdo para a mesma chave.
- Criação concorrente sem duplicação.
- Processamento com sucesso.
- Repetição de processamento concluído.
- Recuperação de falha transitória.
- Bloqueio após rejeição permanente.
- Reconciliação após timeout.
- Processamento concorrente.

## Limitações e evolução para produção

O ERP simulado mantém seus registros em memória. Eles são perdidos
ao reiniciar a API e não são compartilhados entre instâncias.

O timeout é representado por um resultado controlado. Não há
uma chamada de rede real nem medição de prazo de resposta.

A transação permanece aberta durante a interação com o simulador.
Em um ERP real e lento, isso manteria travas e conexões ocupadas.

O estado `processando` e a tentativa só são confirmados no commit.
Se o ERP aceitar o pedido e o processo cair antes do commit, o
registro da tentativa poderá ser perdido. Não existe transação
atômica entre o banco da aplicação e um ERP externo.

A solução não promete processamento exatamente uma vez nem
ausência de duplicação entre reinicializações do simulador.

Antes de produção, seria necessário:

- Persistir a intenção de envio antes da chamada externa.
- Utilizar idempotência durável e reconciliação no ERP.
- Adotar um worker com recuperação de tarefas interrompidas.
- Implementar retentativas com backoff e limite de tentativas.
- Configurar timeouts reais e tratamento de falhas de transporte.
- Adicionar autenticação, autorização e isolamento por cliente.
- Definir retenção de dados, métricas, alertas e gestão de migrations.