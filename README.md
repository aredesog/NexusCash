# NEXUSCASH

Painel de criptomoedas com cotações atualizadas a cada minuto, gráfico de altas (verde) e baixas (vermelho) e uma seção de **Perspectiva** que simula cenários de investimento com base no histórico real da moeda. A paleta é a da LACEN / AWS Builders UNIFAL.

```
Cripto/
├── backend/              
│   ├── main.py           
│   ├── coingecko.py      
│   ├── analysis.py      
│   ├── requirements.txt
│   ├── .env.example      
│   └── .env             
├── frontend/            
└── .gitignore
```

## Como rodar

```bash
cd backend
python -m venv .venv
# Windows:
.venv\Scripts\activate
# Linux/Mac:
source .venv/bin/activate

pip install -r requirements.txt
copy .env.example .env        # (Linux/Mac: cp) e coloque sua chave no .env
uvicorn main:app --reload
```

Abra **http://localhost:8000**. Abrir o `index.html` direto (file://) não funciona mais, porque o front agora conversa com o backend.

A documentação automática da API fica em http://localhost:8000/docs.



## Como funciona a Perspectiva

1. O backend baixa **1 ano de preços diários** da moeda.
2. Calcula os **retornos diários** (log-retornos).
3. Gera **3.000 futuros possíveis** sorteando blocos de 7 dias seguidos desse histórico (*block bootstrap*). Usar blocos mantém juntas as semanas de pânico e de euforia, que é como o mercado se comporta de verdade.
4. Para cada caminho, aplica o valor inicial e os aportes mensais (compra a cada 30 dias, ao preço daquele caminho).
5. Mostra os **percentis**: 5% (pessimista), 25%, 50% (mediana), 75% e 95% (otimista), além da chance de prejuízo e da chance de dobrar.

Há dois cenários:
- **Histórico:** mantém a tendência do último ano. Se a moeda subiu 100%, o modelo "acredita" que vai continuar subindo, e isso costuma ser otimista demais.
- **Neutro:** tira a tendência (média dos retornos = 0) e mantém só a volatilidade. Mede o risco puro e é o mais prudente para decidir.

Raio-X do último ano: retorno, volatilidade anualizada, queda máxima (*max drawdown*), índice de Sharpe (com taxa livre de risco = 0), volatilidade dos últimos 90 dias e retorno de 30 dias.

> **Limitações:** o modelo só "conhece" um ano de comportamento. Crises maiores do que as desse período não aparecem na simulação. Isto é um exercício de estatística e de gestão de risco, **não é previsão nem recomendação de investimento!!**.


## Ideias de evolução

- Taxa livre de risco real (CDI/Selic) no Sharpe, via API do Banco Central.
- Comparar a cripto com o CDI e o Ibovespa no mesmo período.
- Simulação de carteira com várias moedas e rebalanceamento.
