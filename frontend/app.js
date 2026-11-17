/* ============================================================
   NEXUSCASH — lógica principal
   Fonte de dados: backend NEXUSCASH (/api), que consulta a
   CoinGecko com a chave guardada no servidor.
   ============================================================ */
(() => {
  "use strict";

  const API = "/api";
  let COINS = [];          // vem do backend (/api/config)
  let REFRESH = 60;        // idem
  const GREEN = "#00E582";
  const RED = "#FF4D6D";
  const RING_LEN = 94.25; // 2πr (r = 15)

  const $ = (s) => document.querySelector(s);

  // ---------- estado (persistido no navegador) ----------
  const store = {
    get(k, d) { try { return localStorage.getItem("nx_" + k) ?? d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem("nx_" + k, v); } catch { /* sem storage */ } }
  };

  const state = {
    cur: store.get("cur", "brl"),
    sel: store.get("sel", COINS[0]),
    days: Number(store.get("days", 7)),
    mode: store.get("mode", "line"),
    markets: [],
    chart: null,
    left: REFRESH,
    busy: false,
    lastPrice: {}
  };

  // ---------- API (backend) ----------
  async function get(path, params = {}) {
    const u = new URL(API + path, location.origin);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    let r;
    try { r = await fetch(u); }
    catch { throw new Error("Backend fora do ar. Rode: uvicorn main:app --reload (na pasta backend)."); }
    if (!r.ok) {
      let msg = `O servidor respondeu com erro ${r.status}.`;
      try { const j = await r.json(); if (typeof j.detail === "string") msg = j.detail; } catch { /* sem json */ }
      throw new Error(msg);
    }
    return r.json();
  }

  // ---------- formatação ----------
  const money = (v) => {
    if (v == null) return "—";
    const d = v >= 1 ? 2 : v >= 0.01 ? 4 : 8;
    return new Intl.NumberFormat("pt-BR", {
      style: "currency", currency: state.cur.toUpperCase(),
      minimumFractionDigits: d, maximumFractionDigits: d
    }).format(v);
  };
  const compact = (v) => v == null ? "—" : new Intl.NumberFormat("pt-BR", {
    style: "currency", currency: state.cur.toUpperCase(), notation: "compact", maximumFractionDigits: 2
  }).format(v);
  const pct = (v) => v == null ? "—" : (v >= 0 ? "+" : "") + v.toFixed(2).replace(".", ",") + "%";
  const dateLabel = (t, long = false) => {
    const d = new Date(t);
    const opts = state.days <= 1 && !long
      ? { hour: "2-digit", minute: "2-digit" }
      : long
        ? { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }
        : { day: "2-digit", month: "2-digit" };
    return d.toLocaleString("pt-BR", opts);
  };

  const market = (id) => state.markets.find((m) => m.id === id);

  // ---------- lista de moedas ----------
  function sparkline(prices, up) {
    if (!prices || prices.length < 2) return "";
    const w = 74, h = 28;
    const min = Math.min(...prices), max = Math.max(...prices);
    const step = w / (prices.length - 1);
    const pts = prices.map((p, i) => `${(i * step).toFixed(1)},${(h - ((p - min) / (max - min || 1)) * h).toFixed(1)}`);
    return `<svg class="ci-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none">
      <polyline points="${pts.join(" ")}" fill="none" stroke="${up ? GREEN : RED}" stroke-width="1.5" stroke-linejoin="round"/>
    </svg>`;
  }

  function renderList() {
    const q = $("#search").value.trim().toLowerCase();
    const list = state.markets.filter((m) => !q || m.name.toLowerCase().includes(q) || m.symbol.toLowerCase().includes(q));
    $("#coinList").innerHTML = list.map((m) => {
      const ch = m.price_change_percentage_24h;
      const spark = m.sparkline_in_7d?.price || [];
      const weekUp = spark.length ? spark[spark.length - 1] >= spark[0] : ch >= 0;
      return `<li class="coin-item ${m.id === state.sel ? "active" : ""}" data-id="${m.id}">
        <img src="${m.image}" alt="" loading="lazy" />
        <div><div class="ci-name">${m.name}</div><div class="ci-sym">${m.symbol}</div></div>
        ${sparkline(spark, weekUp)}
        <div class="ci-right">
          <div class="ci-price">${money(m.current_price)}</div>
          <div class="ci-pct ${ch >= 0 ? "up" : "down"}">${pct(ch)}</div>
        </div>
      </li>`;
    }).join("") || `<li class="mono" style="color:var(--grey-500);padding:10px">nenhuma moeda encontrada</li>`;
  }

  // ---------- cabeçalho da moeda ----------
  function renderHead() {
    const m = market(state.sel);
    if (!m) return;
    $("#coinImg").src = m.image;
    $("#coinName").textContent = m.name;
    $("#coinSymbol").textContent = m.symbol;
    $("#coinRank").textContent = "#" + (m.market_cap_rank ?? "—");

    const priceEl = $("#coinPrice");
    const key = m.id + state.cur;
    const prev = state.lastPrice[key];
    priceEl.textContent = money(m.current_price);
    if (prev != null && prev !== m.current_price) {
      priceEl.classList.remove("flash-up", "flash-down");
      void priceEl.offsetWidth;
      priceEl.classList.add(m.current_price > prev ? "flash-up" : "flash-down");
      setTimeout(() => priceEl.classList.remove("flash-up", "flash-down"), 1500);
    }
    state.lastPrice[key] = m.current_price;

    const ch = m.price_change_percentage_24h;
    const pill = $("#coinChange");
    pill.textContent = `24h ${pct(ch)}`;
    pill.className = "pill " + (ch >= 0 ? "up" : "down");

    $("#stCap").textContent = compact(m.market_cap);
    $("#stVol").textContent = compact(m.total_volume);
    document.title = `${money(m.current_price)} · ${m.symbol.toUpperCase()} — NEXUSCASH`;
  }

  // ---------- estatísticas ----------
  function renderStats(values, ups, downs) {
    if (!values.length) return;
    const hi = Math.max(...values), lo = Math.min(...values);
    const variation = (values[values.length - 1] / values[0] - 1) * 100;
    $("#stHigh").textContent = money(hi);
    $("#stLow").textContent = money(lo);
    const v = $("#stVar");
    v.textContent = pct(variation);
    v.className = variation >= 0 ? "up" : "down";
    $("#stUpDown").innerHTML = `<span class="up">${ups}▲</span> <span style="color:var(--grey-500)">/</span> <span class="down">${downs}▼</span>`;
  }

  // ---------- gráfico ----------
  const crosshair = {
    id: "crosshair",
    afterDatasetsDraw(chart) {
      const active = chart.tooltip?.getActiveElements?.() || [];
      if (!active.length) return;
      const x = active[0].element.x;
      const { top, bottom } = chart.chartArea;
      const c = chart.ctx;
      c.save();
      c.strokeStyle = "rgba(255,255,255,.2)";
      c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
      c.restore();
    }
  };

  const baseScales = () => ({
    y: {
      position: "right",
      grid: { color: "rgba(255,255,255,.05)" },
      border: { display: false },
      ticks: { color: "#5B6673", font: { family: "'JetBrains Mono', monospace", size: 10 }, callback: (v) => compact(v), maxTicksLimit: 6 }
    }
  });

  const tooltipBase = {
    backgroundColor: "rgba(12,18,24,.95)",
    borderColor: "rgba(255,255,255,.12)",
    borderWidth: 1,
    titleColor: "#98A2AD",
    bodyColor: "#FFFFFF",
    titleFont: { family: "'JetBrains Mono', monospace", size: 11 },
    bodyFont: { family: "'JetBrains Mono', monospace", size: 12, weight: "bold" },
    padding: 10,
    displayColors: false
  };

  function destroyChart() {
    if (state.chart) { state.chart.destroy(); state.chart = null; }
  }

  function drawLine(points) {
    destroyChart();
    const segColor = (c, a = 1) => {
      const up = c.p1.parsed.y >= c.p0.parsed.y;
      return a === 1 ? (up ? GREEN : RED) : (up ? `rgba(0,229,130,${a})` : `rgba(255,77,109,${a})`);
    };

    state.chart = new Chart($("#chart"), {
      type: "line",
      data: {
        datasets: [{
          data: points,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 5,
          pointHoverBorderWidth: 2,
          pointHoverBorderColor: "#0C1218",
          pointHoverBackgroundColor: (c) => {
            const d = c.dataset.data, i = c.dataIndex;
            return i > 0 && d[i].y < d[i - 1].y ? RED : GREEN;
          },
          tension: 0.12,
          fill: "start",
          segment: {
            borderColor: (c) => segColor(c),
            backgroundColor: (c) => segColor(c, 0.07)
          }
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            callbacks: {
              title: (items) => dateLabel(items[0].parsed.x, true),
              label: (item) => money(item.parsed.y)
            }
          }
        },
        scales: {
          x: {
            type: "linear",
            grid: { display: false },
            border: { color: "rgba(255,255,255,.08)" },
            ticks: { color: "#5B6673", font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 8, callback: (v) => dateLabel(v) }
          },
          ...baseScales()
        }
      },
      plugins: [crosshair]
    });
  }

  function drawCandles(ohlc) {
    destroyChart();
    const labels = ohlc.map((r) => r[0]);
    const colors = ohlc.map((r) => (r[4] >= r[1] ? GREEN : RED));

    state.chart = new Chart($("#chart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          { // pavio (mínima → máxima)
            data: ohlc.map((r) => [r[3], r[2]]),
            backgroundColor: colors,
            barThickness: 1.5,
            grouped: false,
            order: 2
          },
          { // corpo (abertura → fechamento)
            data: ohlc.map((r) => (r[1] === r[4] ? [r[1], r[4] * 1.0001] : [r[1], r[4]])),
            backgroundColor: colors,
            borderRadius: 2,
            borderSkipped: false,
            barPercentage: 0.7,
            categoryPercentage: 0.9,
            maxBarThickness: 16,
            grouped: false,
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 450 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            filter: (item) => item.datasetIndex === 1,
            callbacks: {
              title: (items) => dateLabel(labels[items[0].dataIndex], true),
              label: (item) => {
                const [, o, h, l, c] = ohlc[item.dataIndex];
                return [`Abertura   ${money(o)}`, `Máxima     ${money(h)}`, `Mínima     ${money(l)}`, `Fechamento ${money(c)}`, `Variação   ${pct((c / o - 1) * 100)}`];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: "rgba(255,255,255,.08)" },
            ticks: { color: "#5B6673", font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 8, maxRotation: 0, callback: (_, i) => dateLabel(labels[i]) }
          },
          y: { ...baseScales().y, beginAtZero: false }
        }
      },
      plugins: [crosshair]
    });
  }

  function chartMsg(text, isError = false) {
    const el = $("#chartMsg");
    if (!text) { el.classList.add("hidden"); return; }
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.remove("hidden");
  }

  async function loadChart() {
    const { sel: id, cur, days, mode } = state;
    if (!state.chart) chartMsg("carregando gráfico...");

    if (mode === "line") {
      const d = await get(`/chart/${id}`, { vs: cur, days });
      if (id !== state.sel || mode !== state.mode) return; // usuário trocou no meio
      const pts = d.prices.map(([x, y]) => ({ x, y }));
      const m = market(id);
      if (m && pts.length && Date.now() > pts[pts.length - 1].x) pts.push({ x: Date.now(), y: m.current_price });
      let ups = 0, downs = 0;
      for (let i = 1; i < pts.length; i++) pts[i].y >= pts[i - 1].y ? ups++ : downs++;
      drawLine(pts);
      renderStats(pts.map((p) => p.y), ups, downs);
    } else {
      const o = await get(`/ohlc/${id}`, { vs: cur, days });
      if (id !== state.sel || mode !== state.mode) return;
      const ups = o.filter((r) => r[4] >= r[1]).length;
      drawCandles(o);
      // 1º valor = abertura inicial, último = fechamento final (para a variação); máx/mín vêm dos pavios
      const values = o.length ? [o[0][1], ...o.map((r) => r[2]), ...o.map((r) => r[3]), o[o.length - 1][4]] : [];
      renderStats(values, ups, o.length - ups);
    }
    chartMsg(null);
  }

  // ---------- ciclo de atualização ----------
  function setStatus(text, err = false) {
    $("#statusText").textContent = text;
    document.querySelector(".live").classList.toggle("err", err);
  }

  function updateRing() {
    $("#countdown").textContent = state.left;
    $("#ringFg").style.strokeDashoffset = RING_LEN * (1 - state.left / REFRESH);
  }

  async function refresh() {
    if (state.busy) return;
    state.busy = true;
    state.left = REFRESH;
    updateRing();
    $("#refreshBtn").classList.add("spin");
    setStatus("sincronizando...");
    try {
      state.markets = await get("/markets", { vs: state.cur });
      renderList();
      renderHead();
      await loadChart();
      setStatus(`atualizado às ${new Date().toLocaleTimeString("pt-BR")} · próximo em ${REFRESH}s`);
    } catch (e) {
      console.error(e);
      setStatus(e.message, true);
      if (!state.chart) chartMsg(e.message, true);
    } finally {
      state.busy = false;
      $("#refreshBtn").classList.remove("spin");
    }
  }

  async function changeChart() {
    try { await loadChart(); }
    catch (e) { setStatus(e.message, true); chartMsg(e.message, true); }
  }

  // ---------- helpers de UI ----------
  function markSeg(selector, attr, value) {
    document.querySelectorAll(`${selector} button`).forEach((b) => b.classList.toggle("on", b.dataset[attr] === String(value)));
  }

  // ---------- perspectiva (simulação de cenários) ----------
  const pj = {
    months: Number(store.get("pjMonths", 12)),
    sc: store.get("pjSc", "historico"),
    data: null,
    chart: null,
    timer: null,
    reqId: 0
  };

  const HINTS = {
    historico: "Reamostra os retornos diários do último ano <b>com a tendência</b> que a moeda teve. Se ela subiu muito, o cenário assume que continua subindo; se caiu, que continua caindo.",
    neutro: "Mantém a oscilação do último ano, mas <b>tira a tendência</b>. Mostra só o risco, sem apostar que o passado se repete. É o cenário mais prudente."
  };

  const pctPlain = (v) => v == null ? "—" : (v * 100).toFixed(1).replace(".", ",") + "%";

  function pjSetMsg(text, isError = false) {
    const el = $("#pjMsg");
    if (!text) { el.classList.add("hidden"); return; }
    el.textContent = text;
    el.classList.toggle("error", isError);
    el.classList.remove("hidden");
  }

  function pjColors() {
    return pj.sc === "neutro"
      ? { line: "#41B3FF", wide: "rgba(65,179,255,.14)", mid: "rgba(65,179,255,.32)" }
      : { line: GREEN, wide: "rgba(0,229,130,.14)", mid: "rgba(0,229,130,.32)" };
  }

  function pjFutureLabel(day) {
    const d = new Date(Date.now() + day * 86_400_000);
    return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
  }

  function renderProjection() {
    const data = pj.data;
    if (!data) return;
    const s = data.scenarios[pj.sc];
    const col = pjColors();
    document.querySelector(".projection").classList.toggle("neutral", pj.sc === "neutro");
    $("#pjHint").innerHTML = HINTS[pj.sc];
    $("#pjWarning").textContent = data.warning || "";

    // cards de resultado
    const inv = s.invested_total;
    const setVal = (sel, v) => {
      const el = $(sel);
      el.textContent = money(v);
      el.className = v >= inv ? "up" : "down";
    };
    $("#pjInvested").textContent = money(inv);
    setVal("#pjP50", s.final.p50);
    setVal("#pjP5", s.final.p5);
    setVal("#pjP95", s.final.p95);
    $("#pjLoss").textContent = pctPlain(s.prob_loss);
    $("#pjLoss").className = s.prob_loss > 0.5 ? "down" : "";
    $("#pjDouble").textContent = pctPlain(s.prob_double);

    // raio-x
    const m = data.metrics;
    const sign = (sel, v, fmt = pct) => { const el = $(sel); el.textContent = v == null ? "—" : fmt(v); el.className = v == null ? "" : v >= 0 ? "up" : "down"; };
    sign("#mRet", m.return_period == null ? null : m.return_period * 100);
    $("#mVol").textContent = pctPlain(m.volatility_annual);
    sign("#mDD", m.max_drawdown == null ? null : m.max_drawdown * 100);
    sign("#mSharpe", m.sharpe, (v) => v.toFixed(2).replace(".", ","));
    $("#mVol90").textContent = pctPlain(m.volatility_90d);
    sign("#mRet30", m.return_30d == null ? null : m.return_30d * 100);

    // gráfico em leque
    const labels = s.days.map(pjFutureLabel);
    const ds = (data, extra) => ({ data, pointRadius: 0, borderWidth: 0, tension: 0.25, ...extra });
    const datasets = [
      ds(s.p5, { label: "p5", fill: false }),
      ds(s.p95, { label: "p95", fill: "-1", backgroundColor: col.wide }),
      ds(s.p25, { label: "p25", fill: false }),
      ds(s.p75, { label: "p75", fill: "-1", backgroundColor: col.mid }),
      ds(s.p50, { label: "Mediana", borderWidth: 2.5, borderColor: col.line, fill: false }),
      ds(s.invested, { label: "Investido", borderWidth: 1.5, borderColor: "#FF9900", borderDash: [6, 5], fill: false, tension: 0 })
    ];

    if (pj.chart) pj.chart.destroy();
    pj.chart = new Chart($("#pjChart"), {
      type: "line",
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 500 },
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            ...tooltipBase,
            displayColors: false,
            filter: (item) => item.datasetIndex === 4, // um único bloco de texto (via mediana)
            callbacks: {
              title: (items) => `${labels[items[0].dataIndex]} · dia ${s.days[items[0].dataIndex]}`,
              label: (item) => {
                const i = item.dataIndex;
                return [
                  `Otimista (95%)  ${money(s.p95[i])}`,
                  `Bom (75%)       ${money(s.p75[i])}`,
                  `Mediana         ${money(s.p50[i])}`,
                  `Ruim (25%)      ${money(s.p25[i])}`,
                  `Pessimista (5%) ${money(s.p5[i])}`,
                  `Investido       ${money(s.invested[i])}`
                ];
              }
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { color: "rgba(255,255,255,.08)" },
            ticks: { color: "#5B6673", font: { family: "'JetBrains Mono', monospace", size: 10 }, maxTicksLimit: 7, maxRotation: 0 }
          },
          ...baseScales()
        }
      },
      plugins: [crosshair]
    });
    pjSetMsg(null);
  }

  async function runProjection() {
    if (!COINS.length) return;
    const m = market(state.sel);
    $("#pjCoin").textContent = m ? m.name : state.sel;
    document.querySelectorAll(".cur-sym").forEach((el) => (el.textContent = state.cur === "brl" ? "R$" : "US$"));

    const amount = Number($("#pjAmount").value);
    const monthly = Number($("#pjMonthly").value) || 0;
    if (!(amount > 0)) { pjSetMsg("Informe um valor inicial maior que zero.", true); return; }

    const id = ++pj.reqId;
    pjSetMsg("simulando 3.000 cenários...");
    try {
      const data = await get(`/projection/${state.sel}`, {
        vs: state.cur, amount, monthly: Math.max(0, monthly), months: pj.months
      });
      if (id !== pj.reqId) return; // chegou uma resposta mais nova
      pj.data = data;
      renderProjection();
    } catch (e) {
      if (id !== pj.reqId) return;
      pjSetMsg(e.message, true);
    }
  }

  function runProjectionSoon() {
    clearTimeout(pj.timer);
    pj.timer = setTimeout(runProjection, 450);
  }

  // ---------- eventos ----------
  $("#coinList").addEventListener("click", (e) => {
    const li = e.target.closest(".coin-item");
    if (!li || li.dataset.id === state.sel) return;
    state.sel = li.dataset.id;
    store.set("sel", state.sel);
    renderList();
    renderHead();
    destroyChart();
    changeChart();
    runProjectionSoon();
  });

  $("#search").addEventListener("input", renderList);

  $("#curSeg").addEventListener("click", async (e) => {
    const c = e.target.dataset.cur;
    if (!c || c === state.cur) return;
    state.cur = c; store.set("cur", c);
    markSeg("#curSeg", "cur", c);
    destroyChart();
    await refresh();
    runProjection();
  });

  $("#daysSeg").addEventListener("click", (e) => {
    const d = Number(e.target.dataset.days);
    if (!d || d === state.days) return;
    state.days = d; store.set("days", d);
    markSeg("#daysSeg", "days", d);
    changeChart();
  });

  $("#modeSeg").addEventListener("click", (e) => {
    const m = e.target.dataset.mode;
    if (!m || m === state.mode) return;
    state.mode = m; store.set("mode", m);
    markSeg("#modeSeg", "mode", m);
    destroyChart();
    changeChart();
  });

  $("#pjMonths").addEventListener("click", (e) => {
    const m = Number(e.target.dataset.months);
    if (!m || m === pj.months) return;
    pj.months = m; store.set("pjMonths", m);
    markSeg("#pjMonths", "months", m);
    runProjection();
  });

  $("#pjScenario").addEventListener("click", (e) => {
    const sc = e.target.dataset.sc;
    if (!sc || sc === pj.sc) return;
    pj.sc = sc; store.set("pjSc", sc);
    markSeg("#pjScenario", "sc", sc);
    renderProjection(); // os dois cenários já vieram na mesma resposta
  });

  ["#pjAmount", "#pjMonthly"].forEach((sel) => $(sel).addEventListener("input", runProjectionSoon));

  $("#refreshBtn").addEventListener("click", refresh);

  // ---------- início ----------
  async function init() {
    markSeg("#curSeg", "cur", state.cur);
    markSeg("#daysSeg", "days", state.days);
    markSeg("#modeSeg", "mode", state.mode);
    markSeg("#pjMonths", "months", pj.months);
    markSeg("#pjScenario", "sc", pj.sc);
    $("#pjHint").innerHTML = HINTS[pj.sc];

    try {
      const cfg = await get("/config");
      COINS = cfg.coins;
      REFRESH = cfg.refresh_seconds;
      if (!cfg.has_key) console.warn("NEXUSCASH: backend sem COINGECKO_API_KEY. Funciona, mas com limite menor.");
    } catch (e) {
      setStatus(e.message, true);
      chartMsg(e.message, true);
      pjSetMsg(e.message, true);
      return;
    }

    if (!COINS.includes(state.sel)) state.sel = COINS[0];
    state.left = REFRESH;

    setInterval(() => {
      if (state.busy) return;
      state.left = Math.max(0, state.left - 1);
      updateRing();
      if (state.left === 0) refresh();
    }, 1000);

    await refresh();
    runProjection();
  }

  init();
})();
