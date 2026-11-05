import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const baseUrl = "http://127.0.0.1:3000";

async function requisitar(rota, statusEsperado, corpo, headers = {}) {
  const resposta = await fetch(baseUrl + rota, {
    method: corpo === undefined ? "GET" : "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(corpo),
    signal: AbortSignal.timeout(5000),
  });

  assert.equal(resposta.status, statusEsperado, `Resposta HTTP inesperada em ${rota}`);
  return resposta.json();
}

async function demonstrar() {
  await requisitar("/ready", 200);

  const headers = { "Idempotency-Key": `demo-${randomUUID()}` };
  const dados = {
    cliente_id: "cliente-demo",
    itens: [{ produto_id: "produto-demo", quantidade: 2, preco_unitario_centavos: 1500 }],
  };
  const pedido = await requisitar("/pedidos", 201, dados, headers);
  assert.equal(pedido.status, "pendente");
  console.log(`1. Pedido criado: ${pedido.id} (${pedido.status})`);

  const repetido = await requisitar("/pedidos", 200, dados, headers);
  assert.equal(repetido.id, pedido.id);
  console.log("2. Criação repetida com a mesma chave: retornou o mesmo pedido.");

  const rota = `/pedidos/${pedido.id}`;
  const timeout = await requisitar(`${rota}/processar`, 200, {
    cenario: "timeout_apos_processar",
  });
  assert.equal(timeout.status, "resultado_desconhecido");
  console.log(`3. ERP aceitou, mas a confirmação se perdeu: ${timeout.status}.`);

  const reconciliado = await requisitar(`${rota}/processar`, 200, { cenario: "sucesso" });
  assert.equal(reconciliado.status, "concluido");
  console.log(`4. Consulta ao ERP confirmou o aceite: ${reconciliado.status}.`);

  const consulta = await requisitar(rota, 200);
  console.log(`5. Histórico do pedido (ID no ERP: ${consulta.id_pedido_erp})`);
  console.table(consulta.tentativas.map(({ numero_tentativa, resultado, codigo_erro }) => ({
    tentativa: numero_tentativa,
    resultado,
    erro: codigo_erro ?? "",
  })));
}

demonstrar().catch((erro) => {
  console.error(`A demonstração parou: ${erro.message}`);
  if (erro.cause) console.error(erro.cause.message);
  console.error("Confira se a API está rodando na porta 3000 e se o banco foi configurado.");
  process.exitCode = 1;
});
