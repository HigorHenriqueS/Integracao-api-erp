import Fastify from "fastify";
import { db } from "./db.js";
import { pedidosRoutes } from "./routes/pedidos.js";
import type { FastifyError } from "fastify";

export function buildApp() {
  const app = Fastify({
    ajv: {
      customOptions: {
        coerceTypes: false,
        removeAdditional: false,
      },
    },
    logger: {
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
      ],
    },
  });

  app.get("/health", async () => {
    return { status: "ok" };
  });

  app.get("/ready", async (_request, reply) => {
    try {
      await db.query("SELECT 1");
      return { status: "ready" };
    } catch {
      app.log.error("Falha na verificação de conexão com o banco");

      return reply.code(503).send({
        status: "unavailable",
      });
    }
  });

  app.setErrorHandler<FastifyError>((erro, request, reply) => {
    if (erro.validation) {
      return reply.code(400).send({
        mensagem: "Dados da requisição inválidos.",
        detalhes: erro.validation.map((item) => ({
          campo: item.instancePath,
          regra: item.keyword,
          mensagem: item.message,
        })),
      });
    }

    if (
      erro.statusCode &&
      erro.statusCode >= 400 &&
      erro.statusCode < 500
    ) {
      return reply.code(erro.statusCode).send({
        mensagem: "Requisição inválida.",
      });
    }

    // Registra apenas informações selecionadas, sem SQL,
    // conteúdo do pedido, credenciais ou mensagem bruta do banco.
    request.log.error(
      {
        tipo_erro: erro.name,
        codigo:
          typeof erro.code === "string"
            ? erro.code
            : undefined,
      },
      "Erro interno ao atender requisição",
    );

    return reply.code(500).send({
      mensagem: "Erro interno ao processar a solicitação.",
      requisicao_id: request.id,
    });
  });
  app.register(pedidosRoutes);

  return app;
}