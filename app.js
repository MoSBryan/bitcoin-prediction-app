const statusEl = document.getElementById('status');
const lookbackInput = document.getElementById('lookback');
const horizonInput = document.getElementById('horizon');
const refreshBtn = document.getElementById('refreshBtn');

const spotPriceEl = document.getElementById('spotPrice');
const floorPriceEl = document.getElementById('floorPrice');
const floorNoteEl = document.getElementById('floorNote');
const range68PriceEl = document.getElementById('range68Price');
const range68NoteEl = document.getElementById('range68Note');
const range95PriceEl = document.getElementById('range95Price');
const range95NoteEl = document.getElementById('range95Note');
const volatilityEl = document.getElementById('volatility');

const rsiEl = document.getElementById('rsi');
const rsiNoteEl = document.getElementById('rsiNote');
const atrEl = document.getElementById('atr');
const bollingerEl = document.getElementById('bollinger');
const historyBodyEl = document.getElementById('historyBody');

let chart;

// --- Bulletproof y-axis lock (persists per lookback+horizon)
let lastParamsKey = null;
let yAxisLock = null;
const yAxisLockByKey = {}; // { "90-7": {min,max}, ... }

function formatUSD(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPct(value) {
  if (value == null || Number.isNaN(value)) return '-';
  return `${(value * 100).toFixed(2)}%`;
}

function setStatus(text, isError = false) {
  statusEl.textContent = text;
  statusEl.style.color = isError ? '#f9a18a' : 'var(--muted)';
}

function getRsiLabel(rsi) {
  if (rsi == null) return '-';
  if (rsi >= 70) return 'Overbought zone';
  if (rsi <= 30) return 'Oversold zone';
  return 'Neutral momentum';
}

function renderHistory(rows) {
  if (!rows.length) {
    historyBodyEl.innerHTML = '<tr><td colspan="7">No saved predictions yet.</td></tr>';
    return;
  }

  historyBodyEl.innerHTML = rows
    .map((row) => {
      const time = new Date(row.created_at).toLocaleString();
      return `
        <tr>
          <td>${time}</td>
          <td>${formatUSD(row.spot)}</td>
          <td>${formatUSD(row.floor)}</td>
          <td>${formatUSD(row.range68_low)}</td>
          <td>${formatUSD(row.range68_high)}</td>
          <td>${formatUSD(row.range95_low)}</td>
          <td>${formatUSD(row.range95_high)}</td>
        </tr>
      `;
    })
    .join('');
}

function computeYAxisLock(points, model) {
  const closes = points.map((p) => p.close);

  const floorBand = points.map(() => model.floor);
  const range68LowBand = points.map(() => model.range68.low);
  const range68HighBand = points.map(() => model.range68.high);
  const range95LowBand = points.map(() => model.range95.low);
  const range95HighBand = points.map(() => model.range95.high);

  const all = []
    .concat(closes, floorBand, range68LowBand, range68HighBand, range95LowBand, range95HighBand)
    .filter((v) => typeof v === 'number' && Number.isFinite(v));

  if (!all.length) return null;

  const min = Math.min(...all);
  const max = Math.max(...all);

  // If min/max are weirdly equal (flat series), add a bit of padding.
  const pad = (max - min) * 0.10 || Math.max(1, max * 0.02);

  return { min: min - pad, max: max + pad };
}

function renderChart(points, model) {
  const labels = points.map((p) =>
    new Date(p.ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
  );
  const closes = points.map((p) => p.close);

  const floorBand = points.map(() => model.floor);
  const range68LowBand = points.map(() => model.range68.low);
  const range68HighBand = points.map(() => model.range68.high);
  const range95LowBand = points.map(() => model.range95.low);
  const range95HighBand = points.map(() => model.range95.high);

  // Ensure we have a lock (should already be set in loadAndRender, but safe fallback)
  if (!yAxisLock) {
    yAxisLock = computeYAxisLock(points, model);
    if (yAxisLock && lastParamsKey) yAxisLockByKey[lastParamsKey] = yAxisLock;
  }

  if (chart) chart.destroy();

  const ctx = document.getElementById('priceChart');
  chart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: 'BTC Close', data: closes, borderColor: '#f4b942', pointRadius: 0, borderWidth: 2, tension: 0.2 },
        { label: 'Estimated Floor', data: floorBand, borderColor: '#36c28f', borderDash: [7, 5], pointRadius: 0, borderWidth: 1.4 },
        { label: '68% Low', data: range68LowBand, borderColor: '#7ca8f0', borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
        { label: '68% High', data: range68HighBand, borderColor: '#5dd1f3', borderDash: [4, 4], pointRadius: 0, borderWidth: 1 },
        { label: '95% Low', data: range95LowBand, borderColor: '#c0a3ff', borderDash: [3, 5], pointRadius: 0, borderWidth: 1 },
        { label: '95% High', data: range95HighBand, borderColor: '#f08b6f', borderDash: [3, 5], pointRadius: 0, borderWidth: 1 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { labels: { color: '#d5e5ff' } },
        tooltip: {
          callbacks: {
            label(context) {
              return `${context.dataset.label}: ${formatUSD(context.parsed.y)}`;
            },
          },
        },
      },
      scales: {
        x: { ticks: { color: '#9eb6dc', maxTicksLimit: 8 }, grid: { color: 'rgba(165, 185, 220, 0.1)' } },
        y: {
          // If lock exists, force stable min/max. Otherwise let chart autoscale.
          min: yAxisLock ? yAxisLock.min : undefined,
          max: yAxisLock ? yAxisLock.max : undefined,
          ticks: {
            color: '#9eb6dc',
            callback(value) {
              return formatUSD(value);
            },
          },
          grid: { color: 'rgba(165, 185, 220, 0.1)' },
        },
      },
    },
  });
}

async function fetchAnalyze(lookback, horizon) {
  const res = await fetch(`/api/analyze?lookback=${lookback}&horizon=${horizon}`);
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || `Request failed (${res.status})`);
  return payload;
}

async function fetchHistory() {
  const res = await fetch('/api/history?limit=12');
  const payload = await res.json();
  if (!res.ok) throw new Error(payload.error || `History failed (${res.status})`);
  return payload.rows;
}

async function loadAndRender() {
  try {
    setStatus('Fetching latest bitcoin data and calculating model...');
    refreshBtn.disabled = true;

    const lookback = Number(lookbackInput.value);
    const horizon = Number(horizonInput.value);

    // --- Only change lock when inputs change (bulletproof)
    const paramsKey = `${lookback}-${horizon}`;
    if (paramsKey !== lastParamsKey) {
      lastParamsKey = paramsKey;
      yAxisLock = yAxisLockByKey[paramsKey] || null;
    }

    const analysis = await fetchAnalyze(lookback, horizon);
    const model = analysis.model;

    // If we don't already have a lock for this paramsKey, compute it once and store it.
    if (!yAxisLock) {
      yAxisLock = computeYAxisLock(analysis.series, model);
      if (yAxisLock) yAxisLockByKey[paramsKey] = yAxisLock;
    }

    spotPriceEl.textContent = formatUSD(model.spot);
    floorPriceEl.textContent = formatUSD(model.floor);
    floorNoteEl.textContent = `Stress floor: ${formatUSD(model.floor_by_drawdown)} (${formatPct(model.drawdown_risk)} drawdown slice)`;

    range68PriceEl.textContent = `${formatUSD(model.range68.low)} - ${formatUSD(model.range68.high)}`;
    range68NoteEl.textContent = `${analysis.meta.horizon_days}-day expected range`;

    range95PriceEl.textContent = `${formatUSD(model.range95.low)} - ${formatUSD(model.range95.high)}`;
    range95NoteEl.textContent = `${analysis.meta.horizon_days}-day wider risk range`;

    volatilityEl.textContent = formatPct(model.daily_vol);

    const rsi = model.indicators.rsi14;
    rsiEl.textContent = rsi == null ? '-' : rsi.toFixed(1);
    rsiNoteEl.textContent = getRsiLabel(rsi);

    atrEl.textContent = formatUSD(model.indicators.atr14);

    const bb = model.indicators.bollinger20;
    bollingerEl.textContent = `${formatUSD(bb.lower)} / ${formatUSD(bb.upper)}`;

    renderChart(analysis.series, model);

    const rows = await fetchHistory();
    renderHistory(rows);

    setStatus(
      `Updated ${new Date().toLocaleString()} | Requested lookback: ${analysis.meta.requested_lookback_days}d, data provider used: ${analysis.meta.actual_lookback_days}d.`,
    );
  } catch (err) {
    setStatus(`Error: ${err.message}`, true);
  } finally {
    refreshBtn.disabled = false;
  }
}

refreshBtn.addEventListener('click', loadAndRender);
loadAndRender();
