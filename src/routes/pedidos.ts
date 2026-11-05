import { createHash, randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { db } from "../db.js";
import { processarPedido } from "../services/processar-pedido.js";
import type { CenarioErp } from "../services/erp.js";

type DadosPedido = {
  cliente_id: string;
  itens: {
    produto_id: string;
    quantidade: number;
    preco_unitario_centavos: number;
  }[];
};

type PedidoSalvo = {
  id: string;
  hash_conteudo: string;
  status: string;
  created_at: Date;
};

export async function pedidosRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string }; Body: { cenario: CenarioErp };  }>(
    "/pedidos/:id/processar",
    {
        schema: {
        params: {
            type: "object",
            required: ["id"],
            properties: {
            id: {
                type: "string",
                format: "uuid",
            },
            },
        },
        body: {
            type: "object",
            additionalProperties: false,
            required: ["cenario"],
            properties: {
            cenario: {
                type: "string",
                enum: [
                "sucesso",
                "erro_transitorio",
                "erro_permanente",
                "timeout_apos_processar",
                ],
            },
            },
        },
        },
    },
    async (request, reply) => {
        const resultado = await processarPedido(
        request.params.id,
        request.body.cenario,
        );

        request.log.info(
        {
            pedido_id: request.params.id,
            status: resultado.dados.status,
            codigo_http: resultado.codigoHttp,
        },
        "Processamento do pedido",
        );

        return reply
        .code(resultado.codigoHttp)
        .send(resultado.dados);
    },
    );
  app.get<{ Params: { id: string } }>(
    "/pedidos/:id",
    {
        schema: {
        params: {
            type: "object",
            required: ["id"],
            properties: {
            id: {
                type: "string",
                format: "uuid",
            },
            },
        },
        },
    },
    async (request, reply) => {
        const { id } = request.params;

        const consulta = await db.query(
        `
            SELECT
            id,
            status,
            id_pedido_erp,
            proxima_tentativa_em,
            created_at,
            updated_at
            FROM pedidos
            WHERE id = $1
        `,
        [id],
        );

        const pedido = consulta.rows[0];

        if (!pedido) {
        return reply.code(404).send({
            mensagem: "Pedido não encontrado.",
        });
        }

        const tentativas = await db.query(
        `
            SELECT
            numero_tentativa,
            resultado,
            codigo_erro,
            iniciada_em,
            finalizada_em
            FROM tentativas_integracao
            WHERE pedido_id = $1
            ORDER BY numero_tentativa
        `,
        [id],
        );

        return {
        ...pedido,
        tentativas: tentativas.rows,
        };
    },
    );
  app.post<{ Body: DadosPedido }>(
    "/pedidos",
    {
      schema: {
        headers: {
          type: "object",
          required: ["idempotency-key"],
          properties: {
            "idempotency-key": {
              type: "string",
              minLength: 1,
              maxLength: 200,
              pattern: "\\S",
            },
          },
        },
        body: {
          type: "object",
          additionalProperties: false,
          required: ["cliente_id", "itens"],
          properties: {
            cliente_id: {
              type: "string",
              minLength: 1,
              maxLength: 100,
              pattern: "\\S",
            },
            itens: {
              type: "array",
              minItems: 1,
              maxItems: 100,
              items: {
                type: "object",
                additionalProperties: false,
                required: [
                  "produto_id",
                  "quantidade",
                  "preco_unitario_centavos",
                ],
                properties: {
                  produto_id: {
                    type: "string",
                    minLength: 1,
                    maxLength: 100,
                    pattern: "\\S",
                  },
                  quantidade: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100000,
                  },
                  preco_unitario_centavos: {
                    type: "integer",
                    minimum: 1,
                    maximum: 100000000,
                  },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const chave = request.headers["idempotency-key"] as string;

      // Monta uma representação com ordem fixa das propriedades.
      const dados: DadosPedido = {
        cliente_id: request.body.cliente_id,
        itens: request.body.itens.map((item) => ({
          produto_id: item.produto_id,
          quantidade: item.quantidade,
          preco_unitario_centavos: item.preco_unitario_centavos,
        })),
      };

      const conteudo = JSON.stringify(dados);
      const hash = createHash("sha256")
        .update(conteudo)
        .digest("hex");

      const insercao = await db.query<PedidoSalvo>(
        `
          INSERT INTO pedidos (
            id,
            chave_id,
            hash_conteudo,
            dados_pedido
          )
          VALUES ($1, $2, $3, $4::jsonb)
          ON CONFLICT (chave_id) DO NOTHING
          RETURNING id, hash_conteudo, status, created_at
        `,
        [randomUUID(), chave, hash, conteudo],
      );

      let pedido = insercao.rows[0];
      const criado = pedido !== undefined;

      if (!pedido) {
        const existente = await db.query<PedidoSalvo>(
          `
            SELECT id, hash_conteudo, status, created_at
            FROM pedidos
            WHERE chave_id = $1
          `,
          [chave],
        );

        pedido = existente.rows[0];
      }

      if (!pedido) {
        throw new Error("Pedido não encontrado após conflito de chave");
      }

      if (pedido.hash_conteudo !== hash) {
        return reply.code(409).send({
          mensagem:
            "Esta chave de idempotência já foi usada com outro conteúdo.",
        });
      }

      request.log.info(
        { pedido_id: pedido.id, repetido: !criado },
        "Pedido recebido",
      );

      return reply.code(criado ? 201 : 200).send({
        id: pedido.id,
        status: pedido.status,
        created_at: pedido.created_at,
        repetido: !criado,
      });
    },
  );
}