import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import {
  consultarPedidoNoErp,
  enviarPedidoAoErp,
  type CenarioErp,
  type ResultadoErp,
} from "./erp.js";

type Pedido = {
  id: string;
  status: string;
  id_pedido_erp: string | null;
};

type RespostaProcessamento = {
  codigoHttp: number;
  dados: {
    mensagem: string;
    id?: string;
    status?: string;
    id_pedido_erp?: string | null;
  };
};

export async function processarPedido(
  pedidoId: string,
  cenario: CenarioErp,
): Promise<RespostaProcessamento> {
  const conexao = await db.connect();

  try {
    await conexao.query("BEGIN");

    // A trava fica ativa até o COMMIT ou ROLLBACK.
    // NOWAIT faz uma chamada concorrente receber conflito imediatamente.
    const consulta = await conexao.query<Pedido>(
      `
        SELECT id, status, id_pedido_erp
        FROM pedidos
        WHERE id = $1
        FOR UPDATE NOWAIT
      `,
      [pedidoId],
    );

    const pedido = consulta.rows[0];

    if (!pedido) {
      await conexao.query("ROLLBACK");

      return {
        codigoHttp: 404,
        dados: { mensagem: "Pedido não encontrado." },
      };
    }

    if (pedido.status === "concluido") {
      await conexao.query("COMMIT");

      return {
        codigoHttp: 200,
        dados: {
          mensagem: "Pedido já concluído.",
          id: pedido.id,
          status: pedido.status,
          id_pedido_erp: pedido.id_pedido_erp,
        },
      };
    }

    if (
      pedido.status !== "pendente" &&
      pedido.status !== "aguardando_retentativa" &&
      pedido.status !== "resultado_desconhecido"
    ) {
      await conexao.query("ROLLBACK");

      return {
        codigoHttp: 409,
        dados: {
          mensagem: "O estado atual não permite processamento.",
          id: pedido.id,
          status: pedido.status,
        },
      };
    }

    const contagem = await conexao.query<{ numero: number }>(
      `
        SELECT COALESCE(MAX(numero_tentativa), 0) + 1 AS numero
        FROM tentativas_integracao
        WHERE pedido_id = $1
      `,
      [pedidoId],
    );

    const tentativaId = randomUUID();
    const numeroTentativa = contagem.rows[0]!.numero;

    await conexao.query(
      `
        INSERT INTO tentativas_integracao (
          id,
          pedido_id,
          numero_tentativa,
          resultado
        )
        VALUES ($1, $2, $3, 'processando')
      `,
      [tentativaId, pedidoId, numeroTentativa],
    );

    await conexao.query(
      `
        UPDATE pedidos
        SET status = 'processando',
            proxima_tentativa_em = NULL,
            updated_at = NOW()
        WHERE id = $1
      `,
      [pedidoId],
    );

    let resultado: ResultadoErp;

    if (pedido.status === "resultado_desconhecido") {
      // Antes de reenviar, tenta descobrir se o ERP já aceitou.
      const idNoErp = await consultarPedidoNoErp(pedidoId);

      resultado = idNoErp
        ? { tipo: "sucesso", idPedidoErp: idNoErp }
        : {
            tipo: "resultado_desconhecido",
            codigo: "ERP_CONFIRMACAO_INDISPONIVEL",
          };
    } else {
      resultado = await enviarPedidoAoErp(pedidoId, cenario);
    }

    const statusPorResultado = {
      sucesso: "concluido",
      erro_transitorio: "aguardando_retentativa",
      erro_permanente: "falhou",
      resultado_desconhecido: "resultado_desconhecido",
    } as const;

    const novoStatus = statusPorResultado[resultado.tipo];
    const idPedidoErp =
      resultado.tipo === "sucesso" ? resultado.idPedidoErp : null;
    const codigoErro =
      resultado.tipo === "sucesso" ? null : resultado.codigo;

    await conexao.query(
      `
        UPDATE tentativas_integracao
        SET resultado = $2,
            codigo_erro = $3,
            finalizada_em = clock_timestamp()
        WHERE id = $1
      `,
      [tentativaId, resultado.tipo, codigoErro],
    );

    await conexao.query(
      `
        UPDATE pedidos
        SET status = $2,
            id_pedido_erp = $3,
            updated_at = clock_timestamp()
        WHERE id = $1
      `,
      [pedidoId, novoStatus, idPedidoErp],
    );

    await conexao.query("COMMIT");

    return {
      codigoHttp: 200,
      dados: {
        mensagem: "Tentativa de processamento registrada.",
        id: pedidoId,
        status: novoStatus,
        id_pedido_erp: idPedidoErp,
      },
    };
  } catch (erro) {
    await conexao.query("ROLLBACK");

    if (
      typeof erro === "object" &&
      erro !== null &&
      "code" in erro &&
      erro.code === "55P03"
    ) {
      return {
        codigoHttp: 409,
        dados: {
          mensagem: "O pedido está sendo alterado por outra operação.",
        },
      };
    }

    throw erro;
  } finally {
    conexao.release();
  }
}