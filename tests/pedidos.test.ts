import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, test } from "node:test";
import { buildApp } from "../src/app.js";
import { db } from "../src/db.js";

// Impede a execução acidental no banco de desenvolvimento.
if (process.env.DB_NAME !== "api_erp_test") {
  throw new Error("Os testes exigem o banco api_erp_test.");
}

const app = buildApp();

const dadosPedido = {
  cliente_id: "cliente-teste",
  itens: [
    {
      produto_id: "produto-teste",
      quantidade: 2,
      preco_unitario_centavos: 1500,
    },
  ],
};

// Cada teste usa suas próprias chaves para não afetar outros registros.
const chavesCriadas: string[] = [];

function novaChave() {
  const chave = `teste-${randomUUID()}`;
  chavesCriadas.push(chave);
  return chave;
}

function criarPedido(
  chave: string,
  dados: object = dadosPedido,
) {
  return app.inject({
    method: "POST",
    url: "/pedidos",
    headers: {
      "idempotency-key": chave,
    },
    payload: dados,
  });
}

async function criarPedidoParaProcessar() {
  const resposta = await criarPedido(novaChave());

  assert.equal(resposta.statusCode, 201);

  return resposta.json().id as string;
}

function processar(
  pedidoId: string,
  cenario: string,
) {
  return app.inject({
    method: "POST",
    url: `/pedidos/${pedidoId}/processar`,
    payload: { cenario },
  });
}

async function consultarPedido(pedidoId: string) {
  const resposta = await app.inject({
    method: "GET",
    url: `/pedidos/${pedidoId}`,
  });

  assert.equal(resposta.statusCode, 200);

  return resposta.json();
}

before(async () => {
  await app.ready();

  const resultado = await db.query(
    "SELECT current_database() AS banco",
  );

  assert.equal(resultado.rows[0].banco, "api_erp_test");
});

after(async () => {
  try {
    await app.close();

    // Remove somente os pedidos criados por este arquivo de testes.
    // Uma instrução única mantém a limpeza atômica.
    await db.query(
      `
        WITH tentativas_removidas AS (
          DELETE FROM tentativas_integracao
          WHERE pedido_id IN (
            SELECT id
            FROM pedidos
            WHERE chave_id = ANY($1::text[])
          )
        )
        DELETE FROM pedidos
        WHERE chave_id = ANY($1::text[])
      `,
      [chavesCriadas],
    );
  } finally {
    await db.end();
  }
});

test("cria um pedido válido como pendente", async () => {
  const resposta = await criarPedido(novaChave());

  assert.equal(resposta.statusCode, 201);

  const pedido = resposta.json();

  assert.equal(pedido.status, "pendente");
  assert.equal(pedido.repetido, false);
  assert.match(
    pedido.id,
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  );
});

test("rejeita um pedido sem itens", async () => {
  const resposta = await criarPedido(novaChave(), {
    cliente_id: "cliente-teste",
    itens: [],
  });

  assert.equal(resposta.statusCode, 400);
});

test("rejeita uma requisição sem chave de idempotência", async () => {
  const resposta = await app.inject({
    method: "POST",
    url: "/pedidos",
    payload: dadosPedido,
  });

  assert.equal(resposta.statusCode, 400);
});

test("mesma chave e conteúdo retornam o mesmo pedido", async () => {
  const chave = novaChave();

  const primeira = await criarPedido(chave);
  const segunda = await criarPedido(chave);

  assert.equal(primeira.statusCode, 201);
  assert.equal(segunda.statusCode, 200);
  assert.equal(segunda.json().id, primeira.json().id);
  assert.equal(segunda.json().repetido, true);
});

test("mesma chave com conteúdo diferente retorna conflito", async () => {
  const chave = novaChave();

  const primeira = await criarPedido(chave);

  const segunda = await criarPedido(chave, {
    ...dadosPedido,
    cliente_id: "outro-cliente",
  });

  assert.equal(primeira.statusCode, 201);
  assert.equal(segunda.statusCode, 409);

  const consulta = await db.query(
    "SELECT dados_pedido FROM pedidos WHERE chave_id = $1",
    [chave],
  );

  assert.equal(
    consulta.rows[0].dados_pedido.cliente_id,
    "cliente-teste",
  );
});

test("requisições concorrentes criam apenas um pedido", async () => {
  const chave = novaChave();

  const respostas = await Promise.all(
    Array.from({ length: 10 }, () => criarPedido(chave)),
  );

  assert.equal(
    respostas.filter((resposta) => resposta.statusCode === 201).length,
    1,
  );

  assert.equal(
    respostas.filter((resposta) => resposta.statusCode === 200).length,
    9,
  );

  const ids = new Set(
    respostas.map((resposta) => resposta.json().id),
  );

  assert.equal(ids.size, 1);

  const consulta = await db.query(
    "SELECT COUNT(*)::int AS quantidade FROM pedidos WHERE chave_id = $1",
    [chave],
  );

  assert.equal(consulta.rows[0].quantidade, 1);
});

test("processa um pedido com sucesso e registra a tentativa", async () => {
  const id = await criarPedidoParaProcessar();

  const resposta = await processar(id, "sucesso");

  assert.equal(resposta.statusCode, 200);
  assert.equal(resposta.json().status, "concluido");
  assert.ok(resposta.json().id_pedido_erp);

  const pedido = await consultarPedido(id);

  assert.equal(pedido.status, "concluido");
  assert.equal(pedido.tentativas.length, 1);
  assert.equal(pedido.tentativas[0].resultado, "sucesso");
  assert.ok(pedido.tentativas[0].finalizada_em);
});

test("não reprocessa um pedido já concluído", async () => {
  const id = await criarPedidoParaProcessar();

  const primeira = await processar(id, "sucesso");
  const segunda = await processar(id, "sucesso");

  assert.equal(primeira.statusCode, 200);
  assert.equal(segunda.statusCode, 200);
  assert.equal(
    segunda.json().id_pedido_erp,
    primeira.json().id_pedido_erp,
  );

  const pedido = await consultarPedido(id);

  assert.equal(pedido.tentativas.length, 1);
});

test("permite nova tentativa após uma falha transitória", async () => {
  const id = await criarPedidoParaProcessar();

  const primeira = await processar(id, "erro_transitorio");

  assert.equal(primeira.statusCode, 200);
  assert.equal(
    primeira.json().status,
    "aguardando_retentativa",
  );

  const segunda = await processar(id, "sucesso");

  assert.equal(segunda.statusCode, 200);
  assert.equal(segunda.json().status, "concluido");

  const pedido = await consultarPedido(id);

  assert.deepEqual(
    pedido.tentativas.map(
      (tentativa: { resultado: string }) => tentativa.resultado,
    ),
    ["erro_transitorio", "sucesso"],
  );

  assert.equal(
    pedido.tentativas[0].codigo_erro,
    "ERP_INDISPONIVEL",
  );
});

test("bloqueia nova tentativa após uma rejeição permanente", async () => {
  const id = await criarPedidoParaProcessar();

  const primeira = await processar(id, "erro_permanente");

  assert.equal(primeira.statusCode, 200);
  assert.equal(primeira.json().status, "falhou");

  const segunda = await processar(id, "sucesso");

  assert.equal(segunda.statusCode, 409);

  const pedido = await consultarPedido(id);

  assert.equal(pedido.status, "falhou");
  assert.equal(pedido.id_pedido_erp, null);
  assert.equal(pedido.tentativas.length, 1);
  assert.equal(
    pedido.tentativas[0].codigo_erro,
    "ERP_PEDIDO_REJEITADO",
  );
});

test("reconcilia um timeout após o ERP aceitar o pedido", async () => {
  const id = await criarPedidoParaProcessar();

  const primeira = await processar(
    id,
    "timeout_apos_processar",
  );

  assert.equal(primeira.statusCode, 200);
  assert.equal(
    primeira.json().status,
    "resultado_desconhecido",
  );
  assert.equal(primeira.json().id_pedido_erp, null);

  // O cenário de erro permanente não será utilizado:
  // um resultado desconhecido deve consultar o ERP, sem reenviar.
  const segunda = await processar(id, "erro_permanente");

  assert.equal(segunda.statusCode, 200);
  assert.equal(segunda.json().status, "concluido");
  assert.ok(segunda.json().id_pedido_erp);

  const pedido = await consultarPedido(id);

  assert.deepEqual(
    pedido.tentativas.map(
      (tentativa: { resultado: string }) => tentativa.resultado,
    ),
    ["resultado_desconhecido", "sucesso"],
  );

  assert.equal(
    pedido.tentativas[0].codigo_erro,
    "ERP_TIMEOUT",
  );
});

test("processamentos concorrentes registram apenas um envio bem-sucedido", async () => {
  const id = await criarPedidoParaProcessar();

  const respostas = await Promise.all(
    Array.from({ length: 10 }, () =>
      processar(id, "sucesso"),
    ),
  );

  for (const resposta of respostas) {
    assert.ok(
      resposta.statusCode === 200 ||
        resposta.statusCode === 409,
      `Código inesperado: ${resposta.statusCode}`,
    );
  }

  assert.ok(
    respostas.some((resposta) => resposta.statusCode === 200),
  );

  const pedido = await consultarPedido(id);

  assert.equal(pedido.status, "concluido");
  assert.equal(pedido.tentativas.length, 1);
  assert.equal(pedido.tentativas[0].resultado, "sucesso");

  const idsErp = respostas
    .filter((resposta) => resposta.statusCode === 200)
    .map((resposta) => resposta.json().id_pedido_erp);

  assert.equal(new Set(idsErp).size, 1);
  assert.equal(idsErp[0], pedido.id_pedido_erp);
});