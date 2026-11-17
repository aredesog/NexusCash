"""Análise de risco e simulação de cenários (Monte Carlo).

IMPORTANTE: isto NÃO prevê preço. A simulação reamostra o que já aconteceu
(retornos diários do último ano) para mostrar uma FAIXA de futuros possíveis.
Se o mercado mudar de comportamento, a faixa deixa de valer.
"""
from __future__ import annotations

import math

import numpy as np

DAYS_PER_YEAR = 365  # cripto negocia todos os dias


def _num(x):
    """Converte para float do Python, trocando NaN/inf por None (JSON válido)."""
    if x is None:
        return None
    x = float(x)
    return x if math.isfinite(x) else None


def log_returns(prices) -> np.ndarray:
    p = np.asarray(prices, dtype=float)
    p = p[p > 0]
    return np.diff(np.log(p))


def metrics(prices) -> dict:
    """Raio-X do período: retorno, volatilidade, queda máxima, Sharpe/Sortino."""
    p = np.asarray(prices, dtype=float)
    r = log_returns(p)
    mu, sd = r.mean(), r.std(ddof=1)
    vol = sd * math.sqrt(DAYS_PER_YEAR)

    peak = np.maximum.accumulate(p)
    max_dd = (p / peak - 1).min()

    neg = r[r < 0]
    down_vol = neg.std(ddof=1) * math.sqrt(DAYS_PER_YEAR) if len(neg) > 1 else float("nan")
    ann_mu = mu * DAYS_PER_YEAR

    return {
        "days": int(len(p) - 1),
        "return_period": _num(p[-1] / p[0] - 1),
        "volatility_annual": _num(vol),
        "max_drawdown": _num(max_dd),
        # taxa livre de risco = 0 (simplificação didática)
        "sharpe": _num(ann_mu / vol) if vol > 0 else None,
        "sortino": _num(ann_mu / down_vol) if down_vol and down_vol > 0 else None,
        "volatility_90d": _num(r[-90:].std(ddof=1) * math.sqrt(DAYS_PER_YEAR)) if len(r) >= 90 else None,
        "return_30d": _num(p[-1] / p[-31] - 1) if len(p) > 31 else None,
        "up_days_pct": _num((r > 0).mean()),
    }


def simulate(
    prices,
    amount: float,
    monthly: float,
    horizon_days: int,
    *,
    demean: bool = False,
    n_paths: int = 3000,
    block: int = 7,
    points: int = 60,
    seed: int = 42,
) -> dict:
    """Monte Carlo por *block bootstrap* dos retornos diários.

    - Sorteia blocos de `block` dias seguidos do histórico (mantém semanas
      agitadas juntas, em vez de embaralhar dia a dia).
    - demean=False -> cenário "histórico": carrega a tendência do período.
    - demean=True  -> cenário "neutro": tira a tendência, mantém só o risco.
    - Aporte mensal: compra a cada 30 dias, ao preço daquele caminho.
    """
    r = log_returns(prices)
    if demean:
        r = r - r.mean()
    if len(r) <= block:
        raise ValueError("histórico curto demais")

    rng = np.random.default_rng(seed)
    h = int(horizon_days)
    n_blocks = -(-h // block)  # teto
    starts = rng.integers(0, len(r) - block + 1, size=(n_paths, n_blocks))
    idx = (starts[..., None] + np.arange(block)).reshape(n_paths, -1)[:, :h]

    # preço relativo ao de hoje (hoje = 1.0) em cada dia de cada caminho
    growth = np.exp(np.cumsum(r[idx], axis=1))

    contrib_days = np.arange(30, h + 1, 30)  # dias 30, 60, 90...
    buy = np.zeros_like(growth)
    if monthly > 0 and len(contrib_days):
        buy[:, contrib_days - 1] = monthly / growth[:, contrib_days - 1]
    units = amount + np.cumsum(buy, axis=1)  # "cotas" (preço inicial = 1)
    value = units * growth

    day_numbers = np.arange(1, h + 1)
    invested = amount + monthly * np.searchsorted(contrib_days, day_numbers, side="right")

    # amostra ~60 pontos para o gráfico (payload leve)
    sel = np.unique(np.linspace(0, h - 1, points).round().astype(int))
    q = np.percentile(value[:, sel], [5, 25, 50, 75, 95], axis=0)

    final = value[:, -1]
    total_inv = float(invested[-1])
    fq = np.percentile(final, [5, 25, 50, 75, 95])

    def series(arr):
        return [_num(amount)] + [_num(v) for v in arr]

    return {
        "days": [0] + [int(d + 1) for d in sel],
        "p5": series(q[0]),
        "p25": series(q[1]),
        "p50": series(q[2]),
        "p75": series(q[3]),
        "p95": series(q[4]),
        "invested": [_num(amount)] + [_num(invested[d]) for d in sel],
        "final": {
            "p5": _num(fq[0]), "p25": _num(fq[1]), "p50": _num(fq[2]),
            "p75": _num(fq[3]), "p95": _num(fq[4]), "mean": _num(final.mean()),
        },
        "invested_total": total_inv,
        "prob_loss": _num((final < total_inv).mean()),
        "prob_double": _num((final >= 2 * total_inv).mean()),
    }
