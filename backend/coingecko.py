"""Cliente da CoinGecko usado só pelo backend.

A chave fica aqui no servidor (lida do .env) e nunca chega ao navegador.
Tem cache em memória: várias abas abertas dividem a mesma resposta,
o que economiza os créditos mensais do plano Demo.
"""
import time

import httpx

BASE_URL = "https://api.coingecko.com/api/v3"


class ApiError(Exception):
    def __init__(self, status: int, detail: str):
        super().__init__(detail)
        self.status = status
        self.detail = detail


class CoinGecko:
    def __init__(self, api_key: str = ""):
        self.key = (api_key or "").strip()
        headers = {"accept": "application/json"}
        if self.key:
            headers["x-cg-demo-api-key"] = self.key
        self.client = httpx.AsyncClient(base_url=BASE_URL, headers=headers, timeout=15)
        self._cache: dict[str, tuple[float, object]] = {}

    @staticmethod
    def _cache_key(path: str, params: dict | None) -> str:
        items = sorted((params or {}).items())
        return path + "?" + "&".join(f"{k}={v}" for k, v in items)

    async def get(self, path: str, params: dict | None = None, ttl: int = 60):
        key = self._cache_key(path, params)
        hit = self._cache.get(key)
        now = time.time()
        if hit and now - hit[0] < ttl:
            return hit[1]

        try:
            r = await self.client.get(path, params=params)
        except httpx.HTTPError as exc:
            if hit:  # sem conexão: devolve o último dado bom
                return hit[1]
            raise ApiError(502, "Não foi possível conectar à CoinGecko.") from exc

        if r.status_code == 429:
            if hit:
                return hit[1]
            raise ApiError(429, "Limite da CoinGecko atingido. Nova tentativa no próximo ciclo.")
        if r.status_code in (401, 403):
            raise ApiError(502, "Chave da CoinGecko recusada. Confira COINGECKO_API_KEY no backend/.env.")
        if r.status_code == 404:
            raise ApiError(404, "Moeda não encontrada na CoinGecko.")
        if r.status_code >= 400:
            if hit:
                return hit[1]
            raise ApiError(502, f"A CoinGecko respondeu com erro {r.status_code}.")

        data = r.json()
        self._cache[key] = (now, data)
        return data

    async def close(self):
        await self.client.aclose()
