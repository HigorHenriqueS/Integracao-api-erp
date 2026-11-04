BEGIN;

CREATE TABLE pedidos (
    id UUID PRIMARY KEY,
    chave_id VARCHAR(200) NOT NULL UNIQUE,
    hash_conteudo CHAR(64) NOT NULL,
    dados_pedido JSONB NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'pendente',
    id_pedido_erp VARCHAR(100),
    proxima_tentativa_em TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT pedidos_status_valido CHECK (
        status IN (
            'pendente',
            'processando',
            'aguardando_retentativa',
            'concluido',
            'falhou',
            'resultado_desconhecido'
        )
    )
);

CREATE TABLE tentativas_integracao (
    id UUID PRIMARY KEY,
    pedido_id UUID NOT NULL REFERENCES pedidos(id),
    numero_tentativa INTEGER NOT NULL,
    resultado VARCHAR(30) NOT NULL DEFAULT 'processando',
    codigo_erro VARCHAR(100),
    iniciada_em TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    finalizada_em TIMESTAMPTZ,

    CONSTRAINT tentativas_numero_positivo CHECK (
        numero_tentativa > 0
    ),

    CONSTRAINT tentativas_numero_unico_por_pedido UNIQUE (
        pedido_id,
        numero_tentativa
    ),

    CONSTRAINT tentativas_resultado_valido CHECK (
        resultado IN (
            'processando',
            'sucesso',
            'erro_transitorio',
            'erro_permanente',
            'resultado_desconhecido'
        )
    )
);

CREATE INDEX pedidos_proxima_tentativa_idx
    ON pedidos (proxima_tentativa_em)
    WHERE status = 'aguardando_retentativa';

COMMIT;