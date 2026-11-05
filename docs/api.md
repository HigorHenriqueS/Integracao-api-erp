# Referência da API

[Voltar ao README](../README.md).

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

