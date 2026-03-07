import { useState, useEffect, useCallback, useRef } from 'react';
import Head from 'next/head';
import {
  AreaChart, Area, LineChart, Line, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// ─── HELPERS ──────────────────────────────────────────────────────────────────

function fmt(n, type = 'number') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const num = parseFloat(n);
  if (type === 'currency') return `$${num.toLocaleString('es-419', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  if (type === 'percent') return `${num.toFixed(2)}%`;
  if (type === 'roas') return `${num.toFixed(2)}x`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return num.toLocaleString('es-419');
}

function fmtDate(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

async function metaCall(path, params, token) {
  const res = await fetch('/api/meta', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, params, token }),
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error);
  return data;
}

// ─── TOOLTIP ──────────────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label, type }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{
      background: '#0a0f1a', border: '1px solid #1e2d40', borderRadius: 8,
      padding: '10px 14px', fontFamily: 'monospace', fontSize: 12
    }}>
      <p style={{ color: '#5a7a9a', marginBottom: 6, fontSize: 11 }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, margin: '2px 0' }}>
          {p.name}: <strong style={{ color: '#e8f0fe' }}>{fmt(p.value, type)}</strong>
        </p>
      ))}
    </div>
  );
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────

function KpiCard({ label, value, type, color, icon, trend }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0d1520 0%, #111c2e 100%)',
      border: '1px solid #1e2d40', borderRadius: 14,
      padding: '20px 22px', position: 'relative', overflow: 'hidden',
    }}>
      <div style={{
        position: 'absolute', top: 0, right: 0, width: 80, height: 80,
        background: `radial-gradient(circle, ${color}18 0%, transparent 70%)`,
        borderRadius: '0 14px 0 100%',
      }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
        <span style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 18 }}>{icon}</span>
      </div>
      <div style={{ fontFamily: '"Courier New", monospace', fontSize: 28, fontWeight: 700, color: '#e8f0fe', lineHeight: 1 }}>
        {fmt(value, type)}
      </div>
      {trend !== undefined && (
        <div style={{ marginTop: 8, fontSize: 11, color: trend >= 0 ? '#00d9a3' : '#ff5a5a' }}>
          {trend >= 0 ? '▲' : '▼'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color} 0%, transparent 100%)` }} />
    </div>
  );
}

function ChartCard({ title, children, fullWidth }) {
  return (
    <div style={{
      background: 'linear-gradient(135deg, #0d1520 0%, #111c2e 100%)',
      border: '1px solid #1e2d40', borderRadius: 14, padding: '22px 24px',
      gridColumn: fullWidth ? '1 / -1' : undefined,
    }}>
      <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20, margin: '0 0 20px 0' }}>
        {title}
      </p>
      {children}
    </div>
  );
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

export default function Dashboard() {
  const [token, setToken] = useState('');
  const [tokenInput, setTokenInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [accounts, setAccounts] = useState([]);
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [insights, setInsights] = useState([]);
  const [bestAds, setBestAds] = useState([]);
  const [datePreset, setDatePreset] = useState('last_30d');
  const [refreshing, setRefreshing] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [activeChart, setActiveChart] = useState('spend');
  const autoRefreshRef = useRef(null);

  // ── Connect ────────────────────────────────────────────────────────────────
  async function connect(t) {
    setLoading(true);
    setError(null);
    try {
      const data = await metaCall('/me/adaccounts', {
        fields: 'name,account_id,account_status,currency,amount_spent',
        limit: '50',
      }, t);
      const accs = data.data || [];
      setAccounts(accs);
      setToken(t);
      if (accs.length) setSelectedAcc(accs[0]);
      // Save token to sessionStorage so page refresh doesn't lose it
      sessionStorage.setItem('valis_token', t);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Restore token on load
  useEffect(() => {
    const saved = sessionStorage.getItem('valis_token');
    if (saved) connect(saved);
  }, []);

  // ── Load insights ──────────────────────────────────────────────────────────
  const loadInsights = useCallback(async (accId, preset) => {
    if (!accId || !token) return;
    setRefreshing(true);
    try {
      const fields = [
        'date_start', 'spend', 'reach', 'impressions', 'clicks', 'ctr',
        'actions', 'action_values', 'purchase_roas',
        'video_play_actions', 'video_thruplay_watched_actions',
        'frequency',
      ].join(',');

      const data = await metaCall(`/act_${accId}/insights`, {
        fields,
        time_increment: '1',
        date_preset: preset,
        limit: '90',
      }, token);

      const processed = (data.data || []).map(d => {
        const impressions = parseFloat(d.impressions) || 1;
        const videoPlays = parseFloat(d.video_play_actions?.find(a => a.action_type === 'video_view')?.value || 0);
        const thruplays = parseFloat(d.video_thruplay_watched_actions?.find(a => a.action_type === 'video_view')?.value || 0);
        const roas = parseFloat(d.purchase_roas?.[0]?.value || 0);

        return {
          date: fmtDate(d.date_start),
          spend: parseFloat(d.spend) || 0,
          reach: parseFloat(d.reach) || 0,
          impressions,
          clicks: parseFloat(d.clicks) || 0,
          ctr: parseFloat(d.ctr) || 0,
          roas,
          hookRate: parseFloat(((videoPlays / impressions) * 100).toFixed(2)),
          connectionRate: parseFloat(((thruplays / impressions) * 100).toFixed(2)),
          frequency: parseFloat(d.frequency) || 0,
          purchases: parseFloat(d.actions?.find(a => a.action_type === 'purchase')?.value || 0),
        };
      });

      setInsights(processed);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }, [token]);

  // ── Load best ads ──────────────────────────────────────────────────────────
  const loadBestAds = useCallback(async (accId) => {
    if (!accId || !token) return;
    try {
      const data = await metaCall(`/act_${accId}/ads`, {
        fields: 'name,status,insights{spend,reach,clicks,ctr,purchase_roas,actions,impressions,video_thruplay_watched_actions}',
        date_preset: datePreset,
        limit: '25',
      }, token);

      const ads = (data.data || [])
        .filter(a => a.insights?.data?.[0])
        .map(a => {
          const ins = a.insights.data[0];
          const imp = parseFloat(ins.impressions) || 1;
          const thruplays = parseFloat(ins.video_thruplay_watched_actions?.find(x => x.action_type === 'video_view')?.value || 0);
          return {
            name: a.name,
            status: a.status,
            spend: parseFloat(ins.spend) || 0,
            reach: parseFloat(ins.reach) || 0,
            clicks: parseFloat(ins.clicks) || 0,
            ctr: parseFloat(ins.ctr) || 0,
            roas: parseFloat(ins.purchase_roas?.[0]?.value || 0),
            purchases: parseFloat(ins.actions?.find(x => x.action_type === 'purchase')?.value || 0),
            connectionRate: parseFloat(((thruplays / imp) * 100).toFixed(2)),
          };
        })
        .sort((a, b) => b.roas - a.roas || b.spend - a.spend)
        .slice(0, 10);

      setBestAds(ads);
    } catch (_) {}
  }, [token, datePreset]);

  useEffect(() => {
    if (selectedAcc && token) {
      loadInsights(selectedAcc.account_id, datePreset);
      loadBestAds(selectedAcc.account_id);
    }
  }, [selectedAcc, datePreset, loadInsights, loadBestAds]);

  // Auto-refresh every 15 min
  useEffect(() => {
    if (!token || !selectedAcc) return;
    autoRefreshRef.current = setInterval(() => {
      loadInsights(selectedAcc.account_id, datePreset);
    }, 15 * 60 * 1000);
    return () => clearInterval(autoRefreshRef.current);
  }, [token, selectedAcc, datePreset, loadInsights]);

  // ── Totals ─────────────────────────────────────────────────────────────────
  const totals = insights.reduce((acc, d) => ({
    spend: acc.spend + d.spend,
    reach: acc.reach + d.reach,
    impressions: acc.impressions + d.impressions,
    clicks: acc.clicks + d.clicks,
    purchases: acc.purchases + d.purchases,
  }), { spend: 0, reach: 0, impressions: 0, clicks: 0, purchases: 0 });

  const validRoas = insights.filter(d => d.roas > 0);
  const avgRoas = validRoas.length ? validRoas.reduce((s, d) => s + d.roas, 0) / validRoas.length : 0;
  const avgCtr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
  const avgHook = insights.length ? insights.reduce((s, d) => s + d.hookRate, 0) / insights.length : 0;
  const avgConn = insights.length ? insights.reduce((s, d) => s + d.connectionRate, 0) / insights.length : 0;

  // ─────────────────────────────────────────────────────────────────────────
  // STYLES
  // ─────────────────────────────────────────────────────────────────────────
  const baseStyle = {
    minHeight: '100vh',
    background: '#07101c',
    color: '#e8f0fe',
    fontFamily: '"Segoe UI", system-ui, sans-serif',
  };

  const DATE_PRESETS = [
    { v: 'yesterday', l: 'Ayer' },
    { v: 'last_7d', l: '7d' },
    { v: 'last_14d', l: '14d' },
    { v: 'last_30d', l: '30d' },
    { v: 'last_90d', l: '90d' },
  ];

  const CHARTS = [
    { key: 'spend', label: 'Gasto', type: 'currency', color: '#00d9a3' },
    { key: 'impressions', label: 'Impresiones', type: 'number', color: '#4a9eff' },
    { key: 'ctr', label: 'CTR', type: 'percent', color: '#ffb340' },
    { key: 'roas', label: 'ROAS', type: 'roas', color: '#a855f7' },
    { key: 'hookRate', label: 'Hook Rate', type: 'percent', color: '#ff6b6b' },
    { key: 'connectionRate', label: 'Connection Rate', type: 'percent', color: '#00d9a3' },
  ];

  const activeChartCfg = CHARTS.find(c => c.key === activeChart);

  // ── LOGIN SCREEN ───────────────────────────────────────────────────────────
  if (!token) {
    return (
      <>
        <Head>
          <title>Valis Dashboard — Meta Ads</title>
          <meta name="viewport" content="width=device-width, initial-scale=1" />
        </Head>
        <div style={{ ...baseStyle, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <style>{`
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { background: #07101c; }
            .glow { box-shadow: 0 0 30px #00d9a320; }
            @keyframes fadeUp { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
            .fadeup { animation: fadeUp 0.6s ease forwards; }
            @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: 0.4; } }
            .pulse { animation: pulse 2s infinite; }
          `}</style>
          <div className="fadeup" style={{ width: '100%', maxWidth: 460, padding: '40px 20px' }}>
            <div style={{ textAlign: 'center', marginBottom: 40 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 24 }}>
                <div className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#00d9a3', boxShadow: '0 0 12px #00d9a3' }} />
                <span style={{ fontSize: 11, color: '#4a6a8a', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Meta Ads Intelligence</span>
              </div>
              <h1 style={{ fontSize: 44, fontWeight: 800, color: '#e8f0fe', lineHeight: 1, marginBottom: 12, letterSpacing: '-0.02em' }}>
                VALIS<br /><span style={{ color: '#00d9a3', fontStyle: 'italic' }}>Dashboard</span>
              </h1>
              <p style={{ color: '#4a6a8a', fontSize: 14, lineHeight: 1.6 }}>
                Monitoreo en tiempo real de todas tus cuentas. Pega tu token del Graph API Explorer para entrar.
              </p>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #0d1520, #111c2e)',
              border: '1px solid #1e2d40',
              borderRadius: 16, padding: 28
            }} className="glow">
              <label style={{ display: 'block', fontSize: 11, color: '#4a6a8a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>
                Access Token
              </label>
              <textarea
                rows={4}
                placeholder="EAAcQd..."
                value={tokenInput}
                onChange={e => setTokenInput(e.target.value)}
                style={{
                  width: '100%', background: '#07101c', border: '1px solid #1e2d40',
                  color: '#e8f0fe', padding: '12px 14px', borderRadius: 8,
                  fontFamily: 'monospace', fontSize: 12, outline: 'none',
                  resize: 'none', marginBottom: 16, transition: 'border 0.2s',
                }}
                onFocus={e => e.target.style.borderColor = '#00d9a3'}
                onBlur={e => e.target.style.borderColor = '#1e2d40'}
              />

              {error && (
                <div style={{ background: '#1a0a0a', border: '1px solid #ff5a5a30', borderRadius: 8, padding: '10px 14px', color: '#ff8a8a', fontSize: 12, marginBottom: 16 }}>
                  ⚠ {error}
                </div>
              )}

              <button
                disabled={loading || !tokenInput.trim()}
                onClick={() => connect(tokenInput.trim())}
                style={{
                  width: '100%', background: loading ? '#0d1520' : '#00d9a3',
                  color: loading ? '#4a6a8a' : '#000', border: 'none',
                  padding: '14px 0', borderRadius: 8, fontWeight: 700,
                  fontSize: 14, letterSpacing: '0.08em', cursor: loading ? 'not-allowed' : 'pointer',
                  transition: 'all 0.2s',
                }}
              >
                {loading ? 'CONECTANDO...' : '→ ENTRAR AL DASHBOARD'}
              </button>

              <p style={{ color: '#2a3a4a', fontSize: 11, textAlign: 'center', marginTop: 14 }}>
                El token se guarda solo en tu sesión. No sale de tu navegador.
              </p>
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── DASHBOARD ──────────────────────────────────────────────────────────────
  return (
    <>
      <Head>
        <title>Valis — {selectedAcc?.name || 'Dashboard'}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
      </Head>
      <div style={baseStyle}>
        <style>{`
          * { box-sizing: border-box; margin: 0; padding: 0; }
          body { background: #07101c; }
          ::-webkit-scrollbar { width: 4px; height: 4px; }
          ::-webkit-scrollbar-track { background: #0d1520; }
          ::-webkit-scrollbar-thumb { background: #1e2d40; border-radius: 2px; }
          @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
          .fadein { animation: fadeIn 0.4s ease; }
          .chip { background: transparent; border: 1px solid #1e2d40; color: #4a6a8a; padding: 5px 14px; border-radius: 20px; font-size: 11px; cursor: pointer; transition: all 0.2s; white-space: nowrap; font-family: inherit; }
          .chip:hover { border-color: #2e4060; color: #8aaabb; }
          .chip.active { border-color: #00d9a3; color: #00d9a3; background: #00d9a310; }
          .chart-tab { background: transparent; border: 1px solid #1e2d40; color: #4a6a8a; padding: 6px 16px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
          .chart-tab.active { background: #0d1520; border-color: #00d9a3; color: #00d9a3; }
          .chart-tab:hover:not(.active) { border-color: #2e4060; color: #8aaabb; }
          .iconbtn { background: transparent; border: 1px solid #1e2d40; color: #4a6a8a; padding: 6px 14px; border-radius: 6px; font-size: 11px; cursor: pointer; transition: all 0.2s; font-family: inherit; }
          .iconbtn:hover { border-color: #2e4060; color: #8aaabb; }
          td, th { font-family: monospace; }
        `}</style>

        {/* HEADER */}
        <div style={{ borderBottom: '1px solid #1e2d40', padding: '0 28px', position: 'sticky', top: 0, background: '#07101c', zIndex: 100 }}>
          <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>
                VALIS <span style={{ color: '#00d9a3', fontStyle: 'italic', fontWeight: 400, fontSize: 14 }}>ads</span>
              </span>
              <div style={{ width: 1, height: 20, background: '#1e2d40' }} />
              <span style={{ fontSize: 11, color: '#4a6a8a', letterSpacing: '0.08em' }}>{selectedAcc?.name}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {lastUpdated && (
                <span style={{ fontSize: 10, color: '#2a3a4a' }}>
                  {refreshing ? '⟳ actualizando...' : `✓ ${lastUpdated.toLocaleTimeString('es-419')}`}
                </span>
              )}
              <button className="iconbtn" onClick={() => loadInsights(selectedAcc?.account_id, datePreset)}>↻ Actualizar</button>
              <button className="iconbtn" onClick={() => { setToken(''); setAccounts([]); setInsights([]); sessionStorage.removeItem('valis_token'); }}>Salir</button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '24px 28px' }}>

          {/* ACCOUNT SELECTOR */}
          {accounts.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, overflowX: 'auto', paddingBottom: 4 }}>
              {accounts.map(a => (
                <button key={a.account_id} className={`chip ${selectedAcc?.account_id === a.account_id ? 'active' : ''}`}
                  onClick={() => setSelectedAcc(a)}>
                  {a.name}
                </button>
              ))}
            </div>
          )}

          {/* DATE PRESETS */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 28 }}>
            {DATE_PRESETS.map(p => (
              <button key={p.v} className={`chip ${datePreset === p.v ? 'active' : ''}`} onClick={() => setDatePreset(p.v)}>
                {p.l}
              </button>
            ))}
          </div>

          {/* KPI GRID */}
          <div className="fadein" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 14 }}>
            <KpiCard label="Gasto Total" value={totals.spend} type="currency" color="#00d9a3" icon="💰" />
            <KpiCard label="Alcance" value={totals.reach} color="#4a9eff" icon="👁" />
            <KpiCard label="Clicks" value={totals.clicks} color="#ffb340" icon="🖱" />
            <KpiCard label="Compras" value={totals.purchases} color="#a855f7" icon="🛒" />
          </div>
          <div className="fadein" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14, marginBottom: 28 }}>
            <KpiCard label="CTR Promedio" value={avgCtr} type="percent" color="#00d9a3" icon="📊" />
            <KpiCard label="ROAS Promedio" value={avgRoas} type="roas" color="#00d9a3" icon="📈" />
            <KpiCard label="Hook Rate" value={avgHook} type="percent" color="#ffb340" icon="🎣" />
            <KpiCard label="Connection Rate" value={avgConn} type="percent" color="#a855f7" icon="🔗" />
          </div>

          {/* CHART TABS + MAIN CHART */}
          <ChartCard title="Tendencia diaria" fullWidth>
            <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
              {CHARTS.map(c => (
                <button key={c.key} className={`chart-tab ${activeChart === c.key ? 'active' : ''}`}
                  onClick={() => setActiveChart(c.key)}
                  style={activeChart === c.key ? { borderColor: c.color, color: c.color } : {}}>
                  {c.label}
                </button>
              ))}
            </div>
            <ResponsiveContainer width="100%" height={240}>
              <AreaChart data={insights}>
                <defs>
                  <linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={activeChartCfg?.color} stopOpacity={0.3} />
                    <stop offset="95%" stopColor={activeChartCfg?.color} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                <YAxis tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip type={activeChartCfg?.type} />} />
                <Area
                  type="monotone"
                  dataKey={activeChart}
                  stroke={activeChartCfg?.color}
                  fill="url(#grad)"
                  strokeWidth={2}
                  dot={false}
                  name={activeChartCfg?.label}
                />
              </AreaChart>
            </ResponsiveContainer>
          </ChartCard>

          {/* SECONDARY CHARTS */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginTop: 14 }}>
            <ChartCard title="Hook Rate vs Connection Rate (%)">
              <ResponsiveContainer width="100%" height={200}>
                <LineChart data={insights}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                  <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                  <Tooltip content={<ChartTooltip type="percent" />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#4a6a8a' }} />
                  <Line type="monotone" dataKey="hookRate" stroke="#ffb340" strokeWidth={2} dot={false} name="Hook Rate" />
                  <Line type="monotone" dataKey="connectionRate" stroke="#a855f7" strokeWidth={2} dot={false} name="Connection Rate" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>

            <ChartCard title="Gasto vs ROAS">
              <ResponsiveContainer width="100%" height={200}>
                <BarChart data={insights}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                  <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                  <YAxis yAxisId="left" tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fill: '#3a5070', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}x`} />
                  <Tooltip content={<ChartTooltip type="number" />} />
                  <Legend wrapperStyle={{ fontSize: 11, color: '#4a6a8a' }} />
                  <Bar yAxisId="left" dataKey="spend" fill="#00d9a330" radius={[3, 3, 0, 0]} name="Gasto" />
                  <Line yAxisId="right" type="monotone" dataKey="roas" stroke="#a855f7" strokeWidth={2} dot={false} name="ROAS" />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </div>

          {/* BEST ADS TABLE */}
          {bestAds.length > 0 && (
            <div style={{ background: 'linear-gradient(135deg, #0d1520, #111c2e)', border: '1px solid #1e2d40', borderRadius: 14, padding: '22px 24px', marginTop: 14 }}>
              <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 20 }}>
                🏆 Mejores anuncios por ROAS
              </p>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['#', 'Anuncio', 'Estado', 'Gasto', 'Alcance', 'Clicks', 'CTR', 'Compras', 'ROAS', 'Conn. Rate'].map(h => (
                        <th key={h} style={{ textAlign: 'left', padding: '8px 12px', color: '#4a6a8a', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #1e2d40', fontWeight: 500 }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bestAds.map((ad, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #0e1c2c' }}>
                        <td style={{ padding: '11px 12px', color: '#2a3a4a', fontWeight: 700 }}>#{i + 1}</td>
                        <td style={{ padding: '11px 12px', color: '#e8f0fe', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={ad.name}>{ad.name}</td>
                        <td style={{ padding: '11px 12px' }}>
                          <span style={{ padding: '3px 8px', borderRadius: 4, fontSize: 10, fontFamily: 'sans-serif', background: ad.status === 'ACTIVE' ? '#00d9a315' : '#ff5a5a15', color: ad.status === 'ACTIVE' ? '#00d9a3' : '#ff5a5a' }}>
                            {ad.status}
                          </span>
                        </td>
                        <td style={{ padding: '11px 12px', color: '#00d9a3' }}>{fmt(ad.spend, 'currency')}</td>
                        <td style={{ padding: '11px 12px', color: '#e8f0fe' }}>{fmt(ad.reach)}</td>
                        <td style={{ padding: '11px 12px', color: '#e8f0fe' }}>{fmt(ad.clicks)}</td>
                        <td style={{ padding: '11px 12px', color: '#ffb340' }}>{fmt(ad.ctr, 'percent')}</td>
                        <td style={{ padding: '11px 12px', color: '#e8f0fe' }}>{fmt(ad.purchases)}</td>
                        <td style={{ padding: '11px 12px', fontWeight: 700, color: ad.roas >= 3 ? '#00d9a3' : ad.roas >= 1 ? '#ffb340' : '#ff5a5a' }}>
                          {fmt(ad.roas, 'roas')}
                        </td>
                        <td style={{ padding: '11px 12px', color: '#e8f0fe' }}>{fmt(ad.connectionRate, 'percent')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {insights.length === 0 && !refreshing && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#2a3a4a' }}>
              No hay datos para este período.
            </div>
          )}

          <p style={{ textAlign: 'center', color: '#1e2d40', fontSize: 11, marginTop: 32, paddingBottom: 24 }}>
            Valis Dashboard · Se actualiza automáticamente cada 15 min
          </p>
        </div>
      </div>
    </>
  );
}
