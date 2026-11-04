import { randomUUID } from "node:crypto";

export type CenarioErp =
  | "sucesso"
  | "erro_transitorio"
  | "erro_permanente"
  | "timeout_apos_processar";

export type ResultadoErp =
  | {
      tipo: "sucesso";
      idPedidoErp: string;
    }
  | {
      tipo: "erro_transitorio";
      codigo: string;
    }
  | {
      tipo: "erro_permanente";
      codigo: string;
    }
  | {
      tipo: "resultado_desconhecido";
      codigo: string;
    };

// Representa os pedidos aceitos pelo ERP simulado.
// A chave será sempre o ID do pedido da nossa aplicação.
const pedidosAceitos = new Map<string, string>();

export async function enviarPedidoAoErp(
  pedidoId: string,
  cenario: CenarioErp,
): Promise<ResultadoErp> {
  const idExistente = pedidosAceitos.get(pedidoId);

  // O ERP também reconhece repetições da mesma operação.
  if (idExistente) {
    return {
      tipo: "sucesso",
      idPedidoErp: idExistente,
    };
  }

  switch (cenario) {
    case "erro_transitorio":
      return {
        tipo: "erro_transitorio",
        codigo: "ERP_INDISPONIVEL",
      };

    case "erro_permanente":
      return {
        tipo: "erro_permanente",
        codigo: "ERP_PEDIDO_REJEITADO",
      };

    case "timeout_apos_processar": {
      const idPedidoErp = randomUUID();
      pedidosAceitos.set(pedidoId, idPedidoErp);

      // O ERP aceitou, mas a aplicação não recebeu a confirmação.
      return {
        tipo: "resultado_desconhecido",
        codigo: "ERP_TIMEOUT",
      };
    }

    case "sucesso": {
      const idPedidoErp = randomUUID();
      pedidosAceitos.set(pedidoId, idPedidoErp);

      return {
        tipo: "sucesso",
        idPedidoErp,
      };
    }
  }
}

export async function consultarPedidoNoErp(
  pedidoId: string,
): Promise<string | null> {
  return pedidosAceitos.get(pedidoId) ?? null;
}