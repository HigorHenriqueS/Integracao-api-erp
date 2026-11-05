# Arquitetura e decisões técnicas

[Voltar ao README](../README.md).

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

## Cobertura de testes

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
