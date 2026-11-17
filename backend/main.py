"""NEXUSCASH — backend (FastAPI)

- Esconde a chave da CoinGecko (lida do backend/.env).
- Faz cache das respostas para economizar créditos.
- Calcula o raio-x e a simulação de cenários em Python (analysis.py).
- Serve o frontend em http://localhost:8000

Rodar (dentro da pasta backend):
    uvicorn main:app --reload
"""
import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

BASE_DIR = Path(__file__).resolve().parent
# permite importar analysis/coingecko tanto rodando local (cd backend)
# quanto na Vercel (entrypoint "backend.main:app", a partir da raiz)
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))
load_dotenv(BASE_DIR / ".env")  # local; na Vercel as variáveis vêm do painel

from analysis import metrics, simulate  # noqa: E402
from coingecko import ApiError, CoinGecko  # noqa: E402

DEFAULT_COINS = (
    "bitcoin,ethereum,solana,binancecoin,ripple,cardano,"
    "dogecoin,tron,avalanche-2,chainlink,polkadot,litecoin"
)
COINS = [c.strip() for c in os.getenv("COINS", DEFAULT_COINS).split(",") if c.strip()]
REFRESH = max(30, int(os.getenv("REFRESH_SECONDS", "60")))
LIVE_TTL = REFRESH - 5
VS = {"brl", "usd"}
OHLC_DAYS = {1, 7, 14, 30, 90, 180, 365}
FRONTEND = BASE_DIR.parent / "frontend"

cg = CoinGecko(os.getenv("COINGECKO_API_KEY", ""))


@asynccontextmanager
async def lifespan(_app: FastAPI):
    yield
    await cg.close()


app = FastAPI(title="NEXUSCASH API", lifespan=lifespan)


@app.exception_handler(ApiError)
async def api_error_handler(_req: Request, exc: ApiError):
    return JSONResponse(status_code=exc.status, content={"detail": exc.detail})


def check(vs: str, coin: str | None = None):
    if vs not in VS:
        raise HTTPException(400, "Moeda de cotação inválida (use brl ou usd).")
    if coin is not None and coin not in COINS:
        raise HTTPException(404, "Essa moeda não está na lista do NEXUSCASH.")


# ---------------------------------------------------------------- dados ao vivo
@app.get("/api/config")
def config():
    return {"coins": COINS, "refresh_seconds": REFRESH, "has_key": bool(cg.key)}


@app.get("/api/markets")
async def markets(vs: str = "brl"):
    check(vs)
    return await cg.get(
        "/coins/markets",
        {"vs_currency": vs, "ids": ",".join(COINS), "sparkline": "true",
         "price_change_percentage": "24h,7d"},
        ttl=LIVE_TTL,
    )


@app.get("/api/chart/{coin}")
async def chart(coin: str, vs: str = "brl", days: int = Query(7, ge=1, le=365)):
    check(vs, coin)
    return await cg.get(f"/coins/{coin}/market_chart", {"vs_currency": vs, "days": days}, ttl=LIVE_TTL)


@app.get("/api/ohlc/{coin}")
async def ohlc(coin: str, vs: str = "brl", days: int = 7):
    check(vs, coin)
    if days not in OHLC_DAYS:
        raise HTTPException(400, f"Para velas, days deve ser um de {sorted(OHLC_DAYS)}.")
    return await cg.get(f"/coins/{coin}/ohlc", {"vs_currency": vs, "days": days}, ttl=LIVE_TTL)


# ---------------------------------------------------------------- perspectiva
def _run_projection(prices, amount, monthly, horizon):
    return (
        metrics(prices),
        simulate(prices, amount, monthly, horizon, demean=False),
        simulate(prices, amount, monthly, horizon, demean=True),
    )


@app.get("/api/projection/{coin}")
async def projection(
    coin: str,
    vs: str = "brl",
    amount: float = Query(1000, gt=0, le=1e9),
    monthly: float = Query(0, ge=0, le=1e8),
    months: int = Query(12, ge=1, le=24),
):
    check(vs, coin)
    # histórico de 1 ano em candles diários; muda pouco, cache de 1h
    data = await cg.get(f"/coins/{coin}/market_chart", {"vs_currency": vs, "days": 365}, ttl=3600)
    prices = [p for _, p in data.get("prices", []) if p]
    if len(prices) < 60:
        raise HTTPException(422, "Histórico insuficiente para simular essa moeda.")

    horizon = months * 30
    m, hist, neutral = await asyncio.to_thread(_run_projection, prices, amount, monthly, horizon)

    warning = None
    if horizon > m["days"]:
        warning = (f"O horizonte ({horizon} dias) é maior que o histórico usado ({m['days']} dias): "
                   "a incerteza real é ainda maior do que a faixa mostra.")

    return {
        "coin": coin, "vs": vs, "amount": amount, "monthly": monthly,
        "months": months, "horizon_days": horizon,
        "metrics": m,
        "scenarios": {"historico": hist, "neutro": neutral},
        "warning": warning,
    }


# ---------------------------------------------------------------- frontend
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
