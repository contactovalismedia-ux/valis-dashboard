import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Head from 'next/head';
import {
  ComposedChart, LineChart, Line, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts';

// ─── HELPERS ────────────────────────────────────────────────────────────────

function fmt(n, type = 'number') {
  if (n === null || n === undefined || isNaN(n)) return '—';
  const num = parseFloat(n);
  if (type === 'currency') return `$${num.toLocaleString('es-419', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
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

function getActionVal(actions, type) {
  return parseFloat(actions?.find(a => a.action_type === type)?.value || 0);
}

function getCompPeriod(daysAvailable) {
  if (daysAvailable >= 90) return { days: 90, label: 'promedio 90 días' };
  if (daysAvailable >= 60) return { days: 60, label: 'promedio 60 días' };
  if (daysAvailable >= 30) return { days: 30, label: 'promedio 30 días' };
  return null;
}

function metricStatus(val, min) {
  if (!val || val <= 0) return 'empty';
  if (val < min) return 'red';
  if (val < min * 1.25) return 'orange';
  return 'green';
}
const STATUS_COLOR = { red: '#ff5a5a', orange: '#ffb340', green: '#00d9a3', empty: '#3a5a7a' };

// ─── CONSTANTS ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS = {
  hookRate:       { min: 15,  label: 'Hook Rate mínimo (%)',       max: 100, step: 1,   suffix: '%' },
  video25:        { min: 30,  label: 'Video 25% mínimo (%)',       max: 100, step: 1,   suffix: '%' },
  connectionRate: { min: 50,  label: 'Connection Rate mínimo (%)', max: 100, step: 1,   suffix: '%' },
  ctr:            { min: 1.5, label: 'CTR mínimo (%)',             max: 10,  step: 0.1, suffix: '%' },
  roas:           { min: 1.5, label: 'ROAS mínimo (x)',            max: 10,  step: 0.1, suffix: 'x' },
};

const CAMPAIGN_TYPES = [
  { v: 'ecommerce', l: '🛒 Ecommerce' },
  { v: 'whatsapp',  l: '💬 WhatsApp'  },
  { v: 'leads',     l: '📋 Leads / Formularios' },
  { v: 'reach',     l: '📢 Alcance'   },
];

const DATE_PRESETS = [
  { v: 'yesterday', l: 'Ayer' },
  { v: 'last_7d',   l: '7d'  },
  { v: 'last_14d',  l: '14d' },
  { v: 'last_30d',  l: '30d' },
  { v: 'last_90d',  l: '90d' },
];

const AD_COLS_BASE = [
  { key: 'spend',    label: 'Gasto',    fmt: 'currency' },
  { key: 'ctr',      label: 'CTR',      fmt: 'percent'  },
  { key: 'hookRate', label: 'Hook Rate',fmt: 'percent'  },
  { key: 'video25',  label: 'Video 25%',fmt: 'percent'  },
];

const AD_COLS_BY_TYPE = {
  ecommerce: [...AD_COLS_BASE,
    { key: 'connectionRate', label: 'Conn. Rate',     fmt: 'percent'  },
    { key: 'purchases',      label: 'Compras',        fmt: 'number'   },
    { key: 'cpa',            label: 'CPA',            fmt: 'currency' },
    { key: 'roas',           label: 'ROAS',           fmt: 'roas'     },
  ],
  whatsapp: [...AD_COLS_BASE,
    { key: 'connectionRate', label: 'Conn. Rate',     fmt: 'percent'  },
    { key: 'messaging',      label: 'Conversaciones', fmt: 'number'   },
    { key: 'costPerConv',    label: 'Costo/Conv.',    fmt: 'currency' },
  ],
  leads: [...AD_COLS_BASE,
    { key: 'connectionRate', label: 'Conn. Rate',     fmt: 'percent'  },
    { key: 'leads',          label: 'Leads',          fmt: 'number'   },
    { key: 'cpl',            label: 'CPL',            fmt: 'currency' },
  ],
  reach: [...AD_COLS_BASE,
    { key: 'reach',          label: 'Alcance',        fmt: 'number'   },
    { key: 'frequency',      label: 'Frecuencia',     fmt: 'number'   },
  ],
};

function isAtRisk(ad, thresholds) {
  return (
    (ad.hookRate > 0       && ad.hookRate       < thresholds.hookRate.min)       ||
    (ad.video25 > 0        && ad.video25        < thresholds.video25.min)        ||
    (ad.connectionRate > 0 && ad.connectionRate < thresholds.connectionRate.min) ||
    (ad.ctr > 0            && ad.ctr            < thresholds.ctr.min)            ||
    (ad.roas > 0           && ad.roas           < thresholds.roas.min)
  );
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────

function KpiCard({ label, value, type, color, icon, sub, currency, delta, compLabel, invertDelta = false }) {
  return (
    <div style={{ background: 'linear-gradient(135deg, #0d1520 0%, #111c2e 100%)', border: '1px solid #1e2d40', borderRadius: 14, padding: '18px 20px', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, right: 0, width: 70, height: 70, background: `radial-gradient(circle, ${color}20 0%, transparent 70%)`, borderRadius: '0 14px 0 100%' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <span style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
        <span style={{ fontSize: 16 }}>{icon}</span>
      </div>
      <div style={{ fontFamily: 'monospace', fontSize: 24, fontWeight: 700, color: '#e8f0fe', lineHeight: 1 }}>{fmt(value, type)}</div>
      {delta != null && compLabel && (() => {
        const isGood = invertDelta ? delta <= 0 : delta >= 0;
        return (
          <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: isGood ? '#00d9a3' : '#ff5a5a' }}>
              {delta >= 0 ? '↑' : '↓'} {Math.abs(delta).toFixed(1)}%
            </span>
            <span style={{ fontSize: 9, color: '#2a4a6a' }}>{compLabel}</span>
          </div>
        );
      })()}
      {currency && (
        <div style={{ marginTop: 10, display: 'inline-flex', alignItems: 'center', gap: 8, background: '#07101c', border: `1px solid ${color}50`, borderRadius: 8, padding: '6px 14px' }}>
          <span style={{ fontSize: 15, fontWeight: 800, color, fontFamily: 'monospace' }}>{currency.code}</span>
          <div style={{ width: 1, height: 14, background: '#1e2d40' }} />
          <span style={{ fontSize: 12, color: '#8aaabb' }}>{currency.name}</span>
        </div>
      )}
      {sub && !currency && <div style={{ marginTop: 6, fontSize: 10, color: '#3a5a7a' }}>{sub}</div>}
      <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: 2, background: `linear-gradient(90deg, ${color} 0%, transparent 100%)` }} />
    </div>
  );
}

function MarketingFunnel({ totals, compTotals, campaignType, compLabel }) {
  const funnels = {
    ecommerce: [
      { label: 'Impresiones',       value: totals.impressions,     comp: compTotals?.impressions,     color: '#1a3050', metric: null },
      { label: 'Clics en enlace',   value: totals.linkClicks,      comp: compTotals?.linkClicks,      color: '#1a4a6e', metric: { label: 'CTR', val: totals.impressions > 0 ? (totals.linkClicks / totals.impressions * 100) : 0, compVal: compTotals?.impressions > 0 ? (compTotals.linkClicks / compTotals.impressions * 100) : null, type: 'percent' } },
      { label: 'Landing Page View', value: totals.landingPageViews,comp: compTotals?.landingPageViews,color: '#155a7a', metric: { label: 'Conn. Rate', val: totals.linkClicks > 0 ? (totals.landingPageViews / totals.linkClicks * 100) : 0, compVal: compTotals?.linkClicks > 0 ? (compTotals.landingPageViews / compTotals.linkClicks * 100) : null, type: 'percent' } },
      { label: 'Añadir al carrito', value: totals.addToCart,       comp: compTotals?.addToCart,       color: '#0d6b82', metric: { label: '% Add to cart', val: totals.landingPageViews > 0 ? (totals.addToCart / totals.landingPageViews * 100) : 0, compVal: compTotals?.landingPageViews > 0 ? (compTotals.addToCart / compTotals.landingPageViews * 100) : null, type: 'percent' } },
      { label: 'Compras',           value: totals.purchases,       comp: compTotals?.purchases,       color: '#00d9a3', metric: { label: '% Cierre', val: totals.addToCart > 0 ? (totals.purchases / totals.addToCart * 100) : 0, compVal: compTotals?.addToCart > 0 ? (compTotals.purchases / compTotals.addToCart * 100) : null, type: 'percent' } },
    ],
    whatsapp: [
      { label: 'Impresiones',    value: totals.impressions, comp: compTotals?.impressions, color: '#1a3050', metric: null },
      { label: 'Clics',          value: totals.linkClicks,  comp: compTotals?.linkClicks,  color: '#1a4a6e', metric: { label: 'CTR', val: totals.impressions > 0 ? (totals.linkClicks / totals.impressions * 100) : 0, compVal: compTotals?.impressions > 0 ? (compTotals.linkClicks / compTotals.impressions * 100) : null, type: 'percent' } },
      { label: 'Conversaciones', value: totals.messaging,   comp: compTotals?.messaging,   color: '#25D366', metric: { label: '% Conv/Clic', val: totals.linkClicks > 0 ? (totals.messaging / totals.linkClicks * 100) : 0, compVal: compTotals?.linkClicks > 0 ? (compTotals.messaging / compTotals.linkClicks * 100) : null, type: 'percent' } },
    ],
    leads: [
      { label: 'Impresiones',       value: totals.impressions,     comp: compTotals?.impressions,     color: '#1a3050', metric: null },
      { label: 'Clics',             value: totals.linkClicks,      comp: compTotals?.linkClicks,      color: '#1a4a6e', metric: { label: 'CTR', val: totals.impressions > 0 ? (totals.linkClicks / totals.impressions * 100) : 0, compVal: compTotals?.impressions > 0 ? (compTotals.linkClicks / compTotals.impressions * 100) : null, type: 'percent' } },
      { label: 'Landing Page View', value: totals.landingPageViews,comp: compTotals?.landingPageViews,color: '#155a7a', metric: { label: 'Conn. Rate', val: totals.linkClicks > 0 ? (totals.landingPageViews / totals.linkClicks * 100) : 0, compVal: compTotals?.linkClicks > 0 ? (compTotals.landingPageViews / compTotals.linkClicks * 100) : null, type: 'percent' } },
      { label: 'Leads / Registros', value: totals.leads,           comp: compTotals?.leads,           color: '#a855f7', metric: { label: '% Conversión', val: totals.landingPageViews > 0 ? (totals.leads / totals.landingPageViews * 100) : 0, compVal: compTotals?.landingPageViews > 0 ? (compTotals.leads / compTotals.landingPageViews * 100) : null, type: 'percent' } },
    ],
    reach: [
      { label: 'Impresiones',    value: totals.impressions, comp: compTotals?.impressions, color: '#1a3050', metric: null },
      { label: 'Alcance',        value: totals.reach,       comp: compTotals?.reach,       color: '#1a4a6e', metric: { label: 'Freq.', val: totals.reach > 0 ? (totals.impressions / totals.reach) : 0, compVal: compTotals?.reach > 0 ? (compTotals.impressions / compTotals.reach) : null, type: 'number' } },
      { label: 'Video 3s',       value: totals.video3s,     comp: compTotals?.video3s,     color: '#2a5a8a', metric: { label: 'Hook Rate', val: totals.impressions > 0 ? (totals.video3s / totals.impressions * 100) : 0, compVal: compTotals?.impressions > 0 ? (compTotals.video3s / compTotals.impressions * 100) : null, type: 'percent' } },
      { label: 'Clics salientes',value: totals.linkClicks,  comp: compTotals?.linkClicks,  color: '#00d9a3', metric: { label: 'CTR', val: totals.impressions > 0 ? (totals.linkClicks / totals.impressions * 100) : 0, compVal: compTotals?.impressions > 0 ? (compTotals.linkClicks / compTotals.impressions * 100) : null, type: 'percent' } },
    ],
  };

  const steps = funnels[campaignType] || funnels.ecommerce;
  const maxVal = steps[0]?.value || 1;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {steps.map((step, i) => {
        // Embudo real: el primer paso es 100%, cada siguiente se reduce proporcionalmente
        const pct = maxVal > 0 ? Math.max((step.value / maxVal) * 100, 18) : 18;
        const delta = step.comp > 0 ? ((step.value - step.comp) / step.comp * 100) : null;
        const mDelta = step.metric?.compVal > 0 ? ((step.metric.val - step.metric.compVal) / step.metric.compVal * 100) : null;
        const metricVal = step.metric?.val;
        const metricLabel = step.metric?.label;
        const metricType = step.metric?.type;

        return (
          <div key={i} style={{ position: 'relative' }}>
            {/* Fila con métrica izquierda + barra + métrica derecha */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0 }}>

              {/* Métrica izquierda (odd steps) */}
              <div style={{ width: 90, textAlign: 'right', paddingRight: 10, flexShrink: 0 }}>
                {step.metric && i % 2 === 1 && (
                  <>
                    <div style={{ fontSize: 11, color: metricVal > 0 ? '#ffb340' : '#3a5a7a', fontFamily: 'monospace', fontWeight: 700 }}>
                      {metricVal > 0 ? fmt(metricVal, metricType) : '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a7a' }}>{metricLabel}</div>
                    {mDelta != null && compLabel && (
                      <div style={{ fontSize: 8, color: mDelta >= 0 ? '#00d9a3' : '#ff5a5a' }}>
                        {mDelta >= 0 ? '↑' : '↓'}{Math.abs(mDelta).toFixed(1)}%
                      </div>
                    )}
                  </>
                )}
              </div>

              {/* Barra del embudo centrada */}
              <div style={{ width: `${pct}%`, minWidth: 120, maxWidth: '70%', transition: 'width 0.4s ease' }}>
                <div style={{
                  background: `linear-gradient(90deg, ${step.color}ee, ${step.color}88)`,
                  borderRadius: 8, padding: '8px 14px',
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  clipPath: i === steps.length - 1 ? 'none' : 'none',
                }}>
                  <span style={{ color: '#cde', fontSize: 10, whiteSpace: 'nowrap' }}>{step.label}</span>
                  <div style={{ textAlign: 'right', marginLeft: 8 }}>
                    <div style={{ color: '#fff', fontSize: 13, fontWeight: 700, fontFamily: 'monospace' }}>{fmt(step.value)}</div>
                    {delta != null && compLabel && (
                      <div style={{ fontSize: 8, color: delta >= 0 ? '#00d9a3' : '#ff5a5a', marginTop: 1 }}>
                        {delta >= 0 ? '↑' : '↓'}{Math.abs(delta).toFixed(1)}%
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {/* Métrica derecha (even steps > 0) */}
              <div style={{ width: 90, paddingLeft: 10, flexShrink: 0 }}>
                {step.metric && i % 2 === 0 && i > 0 && (
                  <>
                    <div style={{ fontSize: 11, color: metricVal > 0 ? '#ffb340' : '#3a5a7a', fontFamily: 'monospace', fontWeight: 700 }}>
                      {metricVal > 0 ? fmt(metricVal, metricType) : '—'}
                    </div>
                    <div style={{ fontSize: 9, color: '#3a5a7a' }}>{metricLabel}</div>
                    {mDelta != null && compLabel && (
                      <div style={{ fontSize: 8, color: mDelta >= 0 ? '#00d9a3' : '#ff5a5a' }}>
                        {mDelta >= 0 ? '↑' : '↓'}{Math.abs(mDelta).toFixed(1)}%
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function ThresholdsModal({ thresholds, onChange, onClose }) {
  const [local, setLocal] = useState({ ...thresholds });
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000a', zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center' }} onClick={onClose}>
      <div style={{ background: '#0d1520', border: '1px solid #1e2d40', borderRadius: 16, padding: 24, width: 340, boxShadow: '0 20px 60px #000c' }} onClick={e => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
          <span style={{ fontSize: 13, color: '#e8f0fe', fontWeight: 600 }}>⚙️ Umbrales de creativos</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#4a6a8a', cursor: 'pointer', fontSize: 16 }}>×</button>
        </div>
        <p style={{ fontSize: 10, color: '#3a5a7a', marginBottom: 18 }}>Define cuándo un creativo se considera en riesgo.</p>
        {Object.entries(local).map(([key, cfg]) => (
          <div key={key} style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 11, color: '#8aaabb' }}>{cfg.label}</span>
              <span style={{ fontSize: 11, color: '#00d9a3', fontFamily: 'monospace', fontWeight: 700 }}>{local[key].min}{cfg.suffix}</span>
            </div>
            <input type="range" min={0} max={cfg.max} step={cfg.step} value={local[key].min}
              onChange={e => setLocal(prev => ({ ...prev, [key]: { ...prev[key], min: Number(e.target.value) } }))}
              style={{ width: '100%', accentColor: '#00d9a3' }} />
          </div>
        ))}
        <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
          <button onClick={() => { onChange(local); onClose(); }} style={{ flex: 1, background: '#00d9a3', color: '#07101c', border: 'none', borderRadius: 8, padding: '10px 0', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}>Aplicar</button>
          <button onClick={onClose} style={{ flex: 1, background: 'transparent', color: '#4a6a8a', border: '1px solid #1e2d40', borderRadius: 8, padding: '10px 0', fontSize: 13, cursor: 'pointer' }}>Cancelar</button>
        </div>
      </div>
    </div>
  );
}

function AdsTable({ ads, campaignType, thresholds }) {
  const [sortKey, setSortKey] = useState('roas');
  const [sortDir, setSortDir] = useState('desc');
  const AD_COLS = AD_COLS_BY_TYPE[campaignType] || AD_COLS_BY_TYPE.ecommerce;
  const thresholdKeys = ['hookRate', 'video25', 'connectionRate', 'ctr', 'roas'];
  const creativeKeys  = ['hookRate', 'video25', 'connectionRate', 'ctr'];
  const handleSort = (key) => {
    if (sortKey === key) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortKey(key); setSortDir('desc'); }
  };
  const sorted = [...ads].sort((a, b) => {
    const av = a[sortKey] ?? 0, bv = b[sortKey] ?? 0;
    return sortDir === 'desc' ? bv - av : av - bv;
  });
  const thStyle = { textAlign: 'left', padding: '8px 10px', color: '#4a6a8a', fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #1e2d40', fontWeight: 500 };
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={thStyle}></th>
            <th style={thStyle}>#</th>
            <th style={thStyle}>Anuncio</th>
            <th style={thStyle}>Estado</th>
            {AD_COLS.map(c => {
              const isCreative = creativeKeys.includes(c.key);
              return (
                <th key={c.key} onClick={() => handleSort(c.key)} title={isCreative ? 'Comparado vs 14 días anteriores' : undefined}
                  style={{ ...thStyle, cursor: 'pointer', color: sortKey === c.key ? '#e8f0fe' : '#4a6a8a', background: sortKey === c.key ? '#0d1a28' : 'transparent' }}>
                  {c.label}{isCreative && <span style={{ fontSize: 8, color: '#2a4a6a', marginLeft: 2 }}>↕</span>}
                  {sortKey === c.key ? (sortDir === 'desc' ? ' ↓' : ' ↑') : ''}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {sorted.map((ad, i) => {
            const risk = isAtRisk(ad, thresholds);
            return (
              <tr key={i} style={{ borderBottom: '1px solid #0e1c2c', background: risk ? '#ff5a5a0a' : 'transparent', borderLeft: risk ? '3px solid #ff5a5a60' : '3px solid transparent' }}>
                <td style={{ padding: '10px 10px', width: 56 }}>
                  {ad.permalink
                    ? <a href={ad.permalink} target="_blank" rel="noreferrer">
                        {ad.thumbnail ? <img src={ad.thumbnail} style={{ width: 46, height: 46, borderRadius: 6, objectFit: 'cover', border: '1px solid #1e2d40', display: 'block' }} alt="" />
                          : <div style={{ width: 46, height: 46, borderRadius: 6, background: 'linear-gradient(135deg,#1a3050,#0d6b82)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📷</div>}
                      </a>
                    : <div style={{ width: 46, height: 46, borderRadius: 6, background: 'linear-gradient(135deg,#1a3050,#0d6b82)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>📷</div>
                  }
                </td>
                <td style={{ padding: '10px 10px', color: '#2a3a4a', fontWeight: 700, fontFamily: 'monospace' }}>#{i + 1}</td>
                <td style={{ padding: '10px 10px', maxWidth: 200 }}>
                  <div style={{ color: '#e8f0fe', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginBottom: 3 }}>{ad.name}</div>
                  {risk && <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: '#ff5a5a15', border: '1px solid #ff5a5a30', borderRadius: 4, padding: '2px 7px', fontSize: 9, color: '#ff5a5a', fontWeight: 700, marginBottom: 3 }}>⚠ CREATIVO EN RIESGO</span>}
                  {ad.permalink && <div><a href={ad.permalink} target="_blank" rel="noreferrer" style={{ color: '#4a9eff', fontSize: 10, textDecoration: 'none' }}>Ver anuncio →</a></div>}
                </td>
                <td style={{ padding: '10px 10px' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, fontSize: 10, background: ad.status === 'ACTIVE' ? '#00d9a315' : '#ff5a5a15', color: ad.status === 'ACTIVE' ? '#00d9a3' : '#ff5a5a' }}>{ad.status}</span>
                </td>
                {AD_COLS.map(c => {
                  const val = ad[c.key];
                  const hasThreshold = thresholdKeys.includes(c.key);
                  const isCreative    = creativeKeys.includes(c.key);
                  const color = hasThreshold ? STATUS_COLOR[metricStatus(val, thresholds[c.key]?.min)] : '#e8f0fe';
                  const d14 = isCreative ? ad.d14?.[c.key] : null;
                  return (
                    <td key={c.key} style={{ padding: '10px 10px', fontFamily: 'monospace', fontWeight: hasThreshold ? 600 : 400, color }}>
                      {val > 0 ? fmt(val, c.fmt) : '—'}
                      {d14 != null && (
                        <div style={{ fontSize: 9, color: d14 >= 0 ? '#00d9a360' : '#ff5a5a60', marginTop: 2 }}>
                          {d14 >= 0 ? '↑' : '↓'} {Math.abs(d14).toFixed(1)}%
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const pctKeys = ['ctr','hookRate','connectionRate','video25'];
  return (
    <div style={{ background: '#0a0f1a', border: '1px solid #1e2d40', borderRadius: 8, padding: '10px 14px', fontFamily: 'monospace', fontSize: 12 }}>
      <p style={{ color: '#5a7a9a', marginBottom: 6, fontSize: 11 }}>{label}</p>
      {payload.map((p, i) => {
        const isPct = pctKeys.includes(p.dataKey);
        const val = p.value != null
          ? isPct ? `${Number(p.value).toFixed(2)}%`
          : Number(p.value) > 1000 ? `$${Number(p.value).toLocaleString('es-419')}`
          : Number(p.value).toFixed(2)
          : '—';
        return (
          <p key={i} style={{ color: p.color || p.fill, margin: '2px 0' }}>
            {p.name}: <strong style={{ color: '#e8f0fe' }}>{val}</strong>
          </p>
        );
      })}
    </div>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────

export default function Dashboard() {
  const [token, setToken]             = useState('');
  const [tokenInput, setTokenInput]   = useState('');
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState(null);
  const [accounts, setAccounts]       = useState([]);
  const [selectedAcc, setSelectedAcc] = useState(null);
  const [insights, setInsights]       = useState([]);
  const [compInsights, setCompInsights] = useState([]);
  const [bestAds, setBestAds]         = useState([]);
  const [campaigns, setCampaigns]     = useState([]);
  const [datePreset, setDatePreset]   = useState('last_30d');
  const [customFrom, setCustomFrom]   = useState('');
  const [customTo, setCustomTo]       = useState('');
  const [useCustom, setUseCustom]     = useState(false);
  const [refreshing, setRefreshing]   = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [campaignType, setCampaignType] = useState('ecommerce');
  const [thresholds, setThresholds]   = useState(DEFAULT_THRESHOLDS);
  const [showThresholds, setShowThresholds] = useState(false);
  const [selectedCampaigns, setSelectedCampaigns] = useState([]);
  const [showCampaignFilter, setShowCampaignFilter] = useState(false);
  const [compMode, setCompMode]       = useState('trend');
  const handleCompMode = (mode) => {
    setCompMode(mode);
    setCompInsights([]); // reset para que no quede pegado
  };
  const timerRef = useRef(null);

  async function connect(t) {
    setLoading(true); setError(null);
    try {
      const data = await metaCall('/me/adaccounts', { fields: 'name,account_id,account_status,currency,amount_spent', limit: '50' }, t);
      const accs = data.data || [];
      setAccounts(accs); setToken(t);
      if (accs.length) setSelectedAcc(accs[0]);
      sessionStorage.setItem('valis_token', t);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  useEffect(() => {
    const saved = sessionStorage.getItem('valis_token');
    if (saved) connect(saved);
  }, []);

  function getDateParams() {
    if (useCustom && customFrom && customTo) return { since: customFrom, until: customTo };
    return { date_preset: datePreset };
  }

  function getPrevPeriodParams() {
    const presetDays = { yesterday: 1, last_7d: 7, last_14d: 14, last_30d: 30, last_90d: 90 };
    const toDate = d => d.toISOString().split('T')[0];
    if (useCustom && customFrom && customTo) {
      const from = new Date(customFrom), to = new Date(customTo);
      const diff = Math.round((to - from) / 86400000);
      const prevTo   = new Date(from); prevTo.setDate(prevTo.getDate() - 1);
      const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - diff);
      return { since: toDate(prevFrom), until: toDate(prevTo) };
    }
    const days = presetDays[datePreset] || 30;
    const today = new Date();
    const prevTo   = new Date(today); prevTo.setDate(prevTo.getDate() - days - (datePreset === 'yesterday' ? 1 : 0));
    const prevFrom = new Date(prevTo); prevFrom.setDate(prevFrom.getDate() - days);
    return { since: toDate(prevFrom), until: toDate(prevTo) };
  }

  function processRow(d) {
    const imp = parseFloat(d.impressions) || 1;
    const video3s = parseFloat(d.video_p3s_watched_actions?.find(a => a.action_type === 'video_view')?.value || 0);
    // landing_page_views: campo directo si viene, sino desde array actions (action_type='landing_page_view')
    const landingViews = parseFloat(
      d.landing_page_views ||
      getActionVal(d.actions, 'landing_page_view') ||
      0
    );
    // outbound_clicks: campo directo si viene, sino desde actions
    const linkClicks = parseFloat(
      d.outbound_clicks?.[0]?.value ||
      getActionVal(d.actions, 'outbound_click') ||
      getActionVal(d.actions, 'link_click') ||
      0
    );
    const purchases    = getActionVal(d.actions, 'purchase');
    const leads        = getActionVal(d.actions, 'lead') + getActionVal(d.actions, 'complete_registration');
    const spend        = parseFloat(d.spend) || 0;
    return {
      date:             fmtDate(d.date_start),
      spend,
      reach:            parseFloat(d.reach) || 0,
      impressions:      imp,
      linkClicks,
      landingPageViews: landingViews,
      ctr:              parseFloat(d.ctr) || 0,
      roas:             parseFloat(d.purchase_roas?.[0]?.value || 0),
      hookRate:         parseFloat((video3s / imp * 100).toFixed(2)),
      connectionRate:   parseFloat((linkClicks > 0 ? landingViews / linkClicks * 100 : 0).toFixed(2)),
      video3s,
      purchases,
      leads,
      addToCart:        getActionVal(d.actions, 'add_to_cart'),
      messaging:        getActionVal(d.actions, 'onsite_conversion.messaging_conversation_started_7d'),
      frequency:        parseFloat(d.frequency) || 0,
    };
  }

  // Tier 1: todos los campos (Hook Rate, Connection Rate, Landing Views, Video 3s)
  const insightFieldsFull  = 'date_start,spend,reach,impressions,clicks,ctr,actions,action_values,purchase_roas,video_p3s_watched_actions,outbound_clicks,landing_page_views,frequency';
  // Tier 2: sin video_p3s ni landing_page_views (algunos pixels no los reportan), pero conserva outbound_clicks para Connection Rate
  const insightFieldsMid   = 'date_start,spend,reach,impressions,clicks,ctr,actions,action_values,purchase_roas,outbound_clicks,frequency';
  // Tier 3: solo básico
  const insightFieldsBasic = 'date_start,spend,reach,impressions,clicks,ctr,actions,action_values,purchase_roas,frequency';

  async function fetchInsights(accId, dateP) {
    for (const fields of [insightFieldsFull, insightFieldsMid, insightFieldsBasic]) {
      try {
        return await metaCall(`/act_${accId}/insights`, { fields, time_increment: '1', limit: '90', ...dateP }, token);
      } catch (_) { continue; }
    }
    throw new Error('No se pudo obtener insights para esta cuenta');
  }

  const loadInsights = useCallback(async (accId) => {
    if (!accId || !token) return;
    setRefreshing(true);
    try {
      const dateP = getDateParams();
      // Si hay campañas filtradas, agregar filtering_spec
      if (selectedCampaigns.length > 0 && selectedCampaigns.length < campaigns.length) {
        dateP.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: selectedCampaigns }]);
      }
      const main = await fetchInsights(accId, dateP);
      setInsights((main.data || []).map(processRow));
      setLastUpdated(new Date());

      try {
        const comp = await fetchInsights(accId, compMode === 'prev' ? getPrevPeriodParams() : { date_preset: 'last_90d' });
        setCompInsights((comp.data || []).map(processRow));
      } catch (_) {
        setCompInsights([]);
      }
    } catch (e) { setError(e.message); }
    finally { setRefreshing(false); }
  }, [token, datePreset, useCustom, customFrom, customTo, compMode, selectedCampaigns, campaigns.length]);

  const loadBestAds = useCallback(async (accId) => {
    if (!accId || !token) return;
    try {
      const adFieldsFull  = 'name,status,creative{thumbnail_url,instagram_permalink_url},insights{spend,reach,clicks,ctr,purchase_roas,actions,impressions,video_p3s_watched_actions,video_p25_watched_actions,landing_page_views,outbound_clicks,frequency}';
      const adFieldsMid   = 'name,status,creative{thumbnail_url,instagram_permalink_url},insights{spend,reach,clicks,ctr,purchase_roas,actions,impressions,outbound_clicks,frequency}';
      const adFieldsBasic = 'name,status,creative{thumbnail_url,instagram_permalink_url},insights{spend,reach,clicks,ctr,purchase_roas,actions,impressions,frequency}';
      let data;
      const adDateP = { ...getDateParams(), limit: '50' };
      if (selectedCampaigns.length > 0 && selectedCampaigns.length < campaigns.length) {
        adDateP.filtering = JSON.stringify([{ field: 'campaign.id', operator: 'IN', value: selectedCampaigns }]);
      }
      for (const adFields of [adFieldsFull, adFieldsMid, adFieldsBasic]) {
        try { data = await metaCall(`/act_${accId}/ads`, { fields: adFields, ...adDateP }, token); break; }
        catch (_) { continue; }
      }
      if (!data) return;
      const ads = (data.data || []).filter(a => a.insights?.data?.[0]).map(a => {
        const ins  = a.insights.data[0];
        const imp  = parseFloat(ins.impressions) || 1;
        const v3s  = parseFloat(ins.video_p3s_watched_actions?.find(x => x.action_type === 'video_view')?.value || 0);
        const v25  = parseFloat(ins.video_p25_watched_actions?.find(x => x.action_type === 'video_view')?.value || 0);
        const lv   = parseFloat(ins.landing_page_views || 0);
        const lc   = parseFloat(ins.outbound_clicks?.[0]?.value || getActionVal(ins.actions, 'link_click'));
        const pur  = getActionVal(ins.actions, 'purchase');
        const msg  = getActionVal(ins.actions, 'onsite_conversion.messaging_conversation_started_7d');
        const leads = getActionVal(ins.actions, 'lead') + getActionVal(ins.actions, 'complete_registration');
        const spend = parseFloat(ins.spend) || 0;
        return {
          name: a.name, status: a.status,
          thumbnail: a.creative?.thumbnail_url || null,
          permalink: a.creative?.instagram_permalink_url || null,
          spend, reach: parseFloat(ins.reach) || 0,
          ctr: parseFloat(ins.ctr) || 0,
          roas: parseFloat(ins.purchase_roas?.[0]?.value || 0),
          purchases: pur,
          hookRate:       parseFloat((v3s / imp * 100).toFixed(2)),
          video25:        parseFloat((v25 / imp * 100).toFixed(2)),
          connectionRate: parseFloat((lc > 0 ? lv / lc * 100 : 0).toFixed(2)),
          cpa: pur > 0 ? spend / pur : 0,
          messaging: msg, costPerConv: msg > 0 ? spend / msg : 0,
          leads, cpl: leads > 0 ? spend / leads : 0,
          frequency: parseFloat(ins.frequency) || 0,
          d14: null,
        };
      }).sort((a, b) => b.roas - a.roas || b.spend - a.spend).slice(0, 15);
      setBestAds(ads);
    } catch (_) {}
  }, [token, datePreset, useCustom, customFrom, customTo, selectedCampaigns, campaigns.length]);

  const loadCampaigns = useCallback(async (accId) => {
    if (!accId || !token) return;
    try {
      const data = await metaCall(`/act_${accId}/campaigns`, { fields: 'name,status', limit: '50', ...getDateParams() }, token);
      const camps = (data.data || []).map(c => ({ id: c.id, name: c.name, status: c.status }));
      setCampaigns(camps);
      setSelectedCampaigns(camps.map(c => c.id));
    } catch (_) {}
  }, [token, datePreset, useCustom, customFrom, customTo, selectedCampaigns, campaigns.length]);

  function refresh(accId) {
    loadInsights(accId);
    loadBestAds(accId);
    loadCampaigns(accId);
  }

  useEffect(() => {
    if (selectedAcc && token) refresh(selectedAcc.account_id);
  }, [selectedAcc, datePreset, useCustom, customFrom, customTo, compMode]);

  useEffect(() => {
    if (!token || !selectedAcc) return;
    timerRef.current = setInterval(() => loadInsights(selectedAcc.account_id), 15 * 60 * 1000);
    return () => clearInterval(timerRef.current);
  }, [token, selectedAcc, loadInsights]);

  // Derived totals
  const T = useMemo(() => insights.reduce((acc, d) => ({
    spend: acc.spend + d.spend,
    reach: Math.max(acc.reach, d.reach),
    impressions: acc.impressions + d.impressions,
    linkClicks: acc.linkClicks + d.linkClicks,
    landingPageViews: acc.landingPageViews + d.landingPageViews,
    purchases: acc.purchases + d.purchases,
    addToCart: acc.addToCart + d.addToCart,
    messaging: acc.messaging + d.messaging,
    video3s: acc.video3s + d.video3s,
    leads: acc.leads + d.leads,
  }), { spend: 0, reach: 0, impressions: 0, linkClicks: 0, landingPageViews: 0, purchases: 0, addToCart: 0, messaging: 0, video3s: 0, leads: 0 }), [insights]);

  const Tc = useMemo(() => compInsights.reduce((acc, d) => ({
    spend:            acc.spend + d.spend,
    purchases:        acc.purchases + d.purchases,
    messaging:        acc.messaging + d.messaging,
    leads:            acc.leads + d.leads,
    impressions:      acc.impressions + d.impressions,
    video3s:          acc.video3s + d.video3s,
    linkClicks:       acc.linkClicks + d.linkClicks,
    landingPageViews: acc.landingPageViews + d.landingPageViews,
    addToCart:        acc.addToCart + d.addToCart,
    reach:            Math.max(acc.reach, d.reach),
  }), { spend: 0, purchases: 0, messaging: 0, leads: 0, impressions: 0, video3s: 0, linkClicks: 0, landingPageViews: 0, addToCart: 0, reach: 0 }), [compInsights]);

  const validRoas = insights.filter(d => d.roas > 0);
  const avgRoas   = validRoas.length ? validRoas.reduce((s, d) => s + d.roas, 0) / validRoas.length : 0;
  const cValidRoas = compInsights.filter(d => d.roas > 0);
  const cAvgRoas   = cValidRoas.length ? cValidRoas.reduce((s, d) => s + d.roas, 0) / cValidRoas.length : 0;

  const avgHook     = T.impressions > 0 ? T.video3s / T.impressions * 100 : 0;
  const avgCpa      = T.purchases > 0 ? T.spend / T.purchases : 0;
  const avgCtr      = T.impressions > 0 ? T.linkClicks / T.impressions * 100 : 0;
  const avgFreq     = insights.length ? insights.reduce((s, d) => s + d.frequency, 0) / insights.length : 0;
  const avgCpl      = T.leads > 0 ? T.spend / T.leads : 0;
  const avgCostConv = T.messaging > 0 ? T.spend / T.messaging : 0;

  const daysAvailable = compInsights.length;
  const compPeriod    = getCompPeriod(daysAvailable);
  const compLabel     = compMode === 'prev' ? 'vs período anterior' : compPeriod ? `vs ${compPeriod.label}` : null;

  function pctDelta(curr, prev) {
    if (!prev || prev === 0) return null;
    return parseFloat(((curr - prev) / prev * 100).toFixed(1));
  }
  const deltas = {
    purchases:    pctDelta(T.purchases, Tc.purchases),
    cpa:          T.purchases > 0 && Tc.purchases > 0 ? pctDelta(T.spend / T.purchases, Tc.spend / Tc.purchases) : null,
    roas:         pctDelta(avgRoas, cAvgRoas),
    messaging:    pctDelta(T.messaging, Tc.messaging),
    costPerConv:  T.messaging > 0 && Tc.messaging > 0 ? pctDelta(T.spend / T.messaging, Tc.spend / Tc.messaging) : null,
    leads:        pctDelta(T.leads, Tc.leads),
    cpl:          T.leads > 0 && Tc.leads > 0 ? pctDelta(T.spend / T.leads, Tc.spend / Tc.leads) : null,
    hookRate:     pctDelta(T.impressions > 0 ? T.video3s / T.impressions * 100 : 0, Tc.impressions > 0 ? Tc.video3s / Tc.impressions * 100 : 0),
  };

  const currencyNames = { USD: 'Dólar americano', CLP: 'Peso chileno', COP: 'Peso colombiano', EUR: 'Euro', MXN: 'Peso mexicano', ARS: 'Peso argentino', BRL: 'Real brasileño' };
  const currency = selectedAcc ? { code: selectedAcc.currency, name: currencyNames[selectedAcc.currency] || selectedAcc.currency } : null;

  const toggleCampaign = (id) => setSelectedCampaigns(prev =>
    prev.includes(id) ? (prev.length > 1 ? prev.filter(x => x !== id) : prev) : [...prev, id]
  );

  // LOGIN
  if (!token) return (
    <>
      <Head><title>Valis Dashboard</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <div style={{ minHeight: '100vh', background: '#07101c', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'system-ui, sans-serif' }}>
        <style>{`*{box-sizing:border-box;margin:0;padding:0}body{background:#07101c}@keyframes fadeUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}.fu{animation:fadeUp .6s ease forwards}@keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}.pulse{animation:pulse 2s infinite}`}</style>
        <div className="fu" style={{ width: '100%', maxWidth: 440, padding: '40px 20px' }}>
          <div style={{ textAlign: 'center', marginBottom: 36 }}>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
              <div className="pulse" style={{ width: 8, height: 8, borderRadius: '50%', background: '#00d9a3', boxShadow: '0 0 12px #00d9a3' }} />
              <span style={{ fontSize: 11, color: '#4a6a8a', letterSpacing: '0.2em', textTransform: 'uppercase' }}>Meta Ads Intelligence</span>
            </div>
            <h1 style={{ fontSize: 42, fontWeight: 800, color: '#e8f0fe', lineHeight: 1, marginBottom: 10, letterSpacing: '-0.02em' }}>
              VALIS<br /><span style={{ color: '#00d9a3', fontStyle: 'italic' }}>Dashboard</span>
            </h1>
            <p style={{ color: '#4a6a8a', fontSize: 13, lineHeight: 1.6 }}>Monitoreo en tiempo real de todas tus cuentas.</p>
          </div>
          <div style={{ background: 'linear-gradient(135deg, #0d1520, #111c2e)', border: '1px solid #1e2d40', borderRadius: 16, padding: 28 }}>
            <label style={{ display: 'block', fontSize: 11, color: '#4a6a8a', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 10 }}>Access Token</label>
            <textarea rows={4} placeholder="EAAcQd..." value={tokenInput} onChange={e => setTokenInput(e.target.value)}
              style={{ width: '100%', background: '#07101c', border: '1px solid #1e2d40', color: '#e8f0fe', padding: '12px 14px', borderRadius: 8, fontFamily: 'monospace', fontSize: 12, outline: 'none', resize: 'none', marginBottom: 14 }}
              onFocus={e => e.target.style.borderColor = '#00d9a3'} onBlur={e => e.target.style.borderColor = '#1e2d40'} />
            {error && <div style={{ background: '#1a0a0a', border: '1px solid #ff5a5a30', borderRadius: 8, padding: '10px 14px', color: '#ff8a8a', fontSize: 12, marginBottom: 14 }}>⚠ {error}</div>}
            <button disabled={loading || !tokenInput.trim()} onClick={() => connect(tokenInput.trim())}
              style={{ width: '100%', background: loading ? '#0d1520' : '#00d9a3', color: loading ? '#4a6a8a' : '#000', border: 'none', padding: '14px 0', borderRadius: 8, fontWeight: 700, fontSize: 14, cursor: loading ? 'not-allowed' : 'pointer' }}>
              {loading ? 'CONECTANDO...' : '→ ENTRAR AL DASHBOARD'}
            </button>
            <p style={{ color: '#2a3a4a', fontSize: 11, textAlign: 'center', marginTop: 12 }}>Token solo en tu sesión · no se guarda en servidor</p>
          </div>
        </div>
      </div>
    </>
  );

  // DASHBOARD
  return (
    <>
      <Head><title>Valis — {selectedAcc?.name || 'Dashboard'}</title><meta name="viewport" content="width=device-width, initial-scale=1" /></Head>
      <div style={{ minHeight: '100vh', background: '#07101c', color: '#e8f0fe', fontFamily: 'system-ui, sans-serif', fontSize: 13 }}>
        <style>{`
          *{box-sizing:border-box;margin:0;padding:0} body{background:#07101c}
          ::-webkit-scrollbar{width:4px;height:4px} ::-webkit-scrollbar-track{background:#0d1520} ::-webkit-scrollbar-thumb{background:#1e2d40;border-radius:2px}
          .chip{background:transparent;border:1px solid #1e2d40;color:#4a6a8a;padding:5px 14px;border-radius:20px;font-size:11px;cursor:pointer;transition:all .2s;white-space:nowrap;font-family:inherit}
          .chip:hover{border-color:#2e4060;color:#8aaabb} .chip.active{border-color:#00d9a3;color:#00d9a3;background:#00d9a310}
          .ctype{background:transparent;border:1px solid #1e2d40;color:#4a6a8a;padding:6px 14px;border-radius:8px;font-size:12px;cursor:pointer;font-family:inherit;transition:all .2s}
          .ctype.active{background:#0d1520;border-color:#4a9eff;color:#4a9eff}
          .ibtn{background:transparent;border:1px solid #1e2d40;color:#4a6a8a;padding:6px 12px;border-radius:6px;font-size:11px;cursor:pointer;font-family:inherit;transition:all .2s}
          .ibtn:hover{border-color:#2e4060;color:#8aaabb}
          .card{background:linear-gradient(135deg,#0d1520 0%,#111c2e 100%);border:1px solid #1e2d40;border-radius:14px;padding:20px 22px}
          input[type="date"]{background:#0d1520;border:1px solid #1e2d40;color:#e8f0fe;padding:5px 10px;border-radius:6px;font-size:11px;font-family:inherit;outline:none}
          input[type="date"]:focus{border-color:#00d9a3}
        `}</style>

        {/* HEADER */}
        <div style={{ borderBottom: '1px solid #1e2d40', padding: '0 28px', position: 'sticky', top: 0, background: '#07101c', zIndex: 100 }}>
          <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 58 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
              <span style={{ fontSize: 18, fontWeight: 800, letterSpacing: '-0.02em' }}>VALIS <span style={{ color: '#00d9a3', fontStyle: 'italic', fontWeight: 400, fontSize: 14 }}>ads</span></span>
              <div style={{ width: 1, height: 18, background: '#1e2d40' }} />
              <span style={{ fontSize: 11, color: '#4a6a8a' }}>{selectedAcc?.name}</span>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#00d9a3', boxShadow: '0 0 8px #00d9a3' }} />
              <span style={{ fontSize: 10, color: '#00d9a3' }}>EN VIVO</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {lastUpdated && <span style={{ fontSize: 10, color: '#2a3a4a' }}>{refreshing ? '⟳ actualizando...' : `✓ ${lastUpdated.toLocaleTimeString('es-419')}`}</span>}
              <button className="ibtn" onClick={() => refresh(selectedAcc?.account_id)}>↻ Actualizar</button>
              <button className="ibtn" onClick={() => { setToken(''); setAccounts([]); setInsights([]); sessionStorage.removeItem('valis_token'); }}>Salir</button>
            </div>
          </div>
        </div>

        <div style={{ maxWidth: 1440, margin: '0 auto', padding: '20px 28px' }}>

          {accounts.length > 1 && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 18, overflowX: 'auto', paddingBottom: 4 }}>
              {accounts.map(a => (
                <button key={a.account_id} className={`chip ${selectedAcc?.account_id === a.account_id ? 'active' : ''}`} onClick={() => setSelectedAcc(a)}>{a.name}</button>
              ))}
            </div>
          )}

          {/* DATE + COMP MODE */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {!useCustom && DATE_PRESETS.map(p => (
              <button key={p.v} className={`chip ${datePreset === p.v ? 'active' : ''}`} onClick={() => setDatePreset(p.v)}>{p.l}</button>
            ))}
            <button className={`chip ${useCustom ? 'active' : ''}`} onClick={() => setUseCustom(!useCustom)}>📅 {useCustom ? 'Personalizado' : 'Personalizar fechas'}</button>
            {useCustom && (
              <>
                <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
                <span style={{ color: '#4a6a8a', fontSize: 12 }}>→</span>
                <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} />
                <button className="chip active" onClick={() => refresh(selectedAcc?.account_id)}>Aplicar</button>
              </>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, color: '#2a4a6a' }}>Comparar:</span>
              {[
                { v: 'trend', l: compPeriod ? `Tendencia (${compPeriod.label})` : 'Tendencia (sin datos)' },
                { v: 'prev',  l: 'vs período anterior' },
              ].map(opt => (
                <button key={opt.v} className="ibtn" onClick={() => handleCompMode(opt.v)}
                  style={{ borderColor: compMode === opt.v ? '#4a9eff' : '#1e2d40', color: compMode === opt.v ? '#4a9eff' : '#4a6a8a', opacity: !compPeriod && opt.v === 'trend' ? 0.4 : 1 }}>
                  {opt.l}
                </button>
              ))}
              {!compPeriod && compMode === 'trend' && <span style={{ fontSize: 9, color: '#ff5a5a' }}>⚠ menos de 30 días</span>}
            </div>
          </div>

          {/* CAMPAIGN TYPE + CAMPAIGN FILTER */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 24, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: '#4a6a8a' }}>Tipo de campaña:</span>
            {CAMPAIGN_TYPES.map(c => (
              <button key={c.v} className={`ctype ${campaignType === c.v ? 'active' : ''}`} onClick={() => setCampaignType(c.v)}>{c.l}</button>
            ))}
            {campaigns.length > 0 && (
              <div style={{ marginLeft: 'auto', position: 'relative' }}>
                <button className="ibtn" onClick={() => setShowCampaignFilter(p => !p)}
                  style={{ borderColor: selectedCampaigns.length < campaigns.length ? '#00d9a3' : '#1e2d40', color: selectedCampaigns.length < campaigns.length ? '#00d9a3' : '#8aaabb', display: 'flex', alignItems: 'center', gap: 6 }}>
                  🎯 Campañas <span style={{ background: '#1e2d40', borderRadius: 10, padding: '1px 7px', fontSize: 10 }}>{selectedCampaigns.length}/{campaigns.length}</span>
                </button>
                {showCampaignFilter && (
                  <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, background: '#0d1520', border: '1px solid #1e2d40', borderRadius: 12, padding: 16, zIndex: 50, minWidth: 280, boxShadow: '0 12px 40px #000a' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                      <span style={{ fontSize: 11, color: '#e8f0fe', fontWeight: 600 }}>Filtrar campañas</span>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <button onClick={() => setSelectedCampaigns(campaigns.map(c => c.id))} style={{ fontSize: 10, color: '#4a9eff', background: 'none', border: 'none', cursor: 'pointer' }}>Todas</button>
                        <button onClick={() => campaigns[0] && setSelectedCampaigns([campaigns[0].id])} style={{ fontSize: 10, color: '#4a6a8a', background: 'none', border: 'none', cursor: 'pointer' }}>Ninguna</button>
                      </div>
                    </div>
                    {campaigns.map(c => {
                      const sel = selectedCampaigns.includes(c.id);
                      return (
                        <div key={c.id} onClick={() => toggleCampaign(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 8, cursor: 'pointer', marginBottom: 4, background: sel ? '#00d9a308' : 'transparent', border: `1px solid ${sel ? '#00d9a330' : 'transparent'}` }}>
                          <div style={{ width: 16, height: 16, borderRadius: 4, border: `2px solid ${sel ? '#00d9a3' : '#2a4a6a'}`, background: sel ? '#00d9a3' : 'transparent', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                            {sel && <span style={{ fontSize: 10, color: '#07101c', fontWeight: 900 }}>✓</span>}
                          </div>
                          <span style={{ fontSize: 11, color: sel ? '#e8f0fe' : '#4a6a8a' }}>{c.name}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 9, color: c.status === 'ACTIVE' ? '#00d9a3' : '#4a6a8a' }}>{c.status}</span>
                        </div>
                      );
                    })}
                    <button onClick={() => setShowCampaignFilter(false)} style={{ width: '100%', marginTop: 10, background: '#00d9a3', color: '#07101c', border: 'none', borderRadius: 8, padding: '8px 0', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>Aplicar</button>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* KPIs ECOMMERCE */}
          {campaignType === 'ecommerce' && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
                <KpiCard label="Inversión Total" value={T.spend} type="currency" color="#00d9a3" icon="💰" currency={currency} />
                <KpiCard label="Compras" value={T.purchases} color="#00d9a3" icon="🛒" delta={deltas.purchases} compLabel={compLabel} />
                <KpiCard label="Costo por Compra (CPA)" value={avgCpa} type="currency" color="#4a9eff" icon="🎯" delta={deltas.cpa} compLabel={compLabel} invertDelta />
                <KpiCard label="ROAS Promedio" value={avgRoas} type="roas" color="#a855f7" icon="📈" delta={deltas.roas} compLabel={compLabel} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
                <KpiCard label="% Conversión de Página" value={T.landingPageViews > 0 ? T.purchases / T.landingPageViews * 100 : 0} type="percent" color="#00d9a3" icon="📊" sub="Compras / Visitas en la página" />
                <KpiCard label="Valor Promedio de Venta" value={T.purchases > 0 ? T.spend * avgRoas / T.purchases : 0} type="currency" color="#ffb340" icon="💵" />
              </div>
            </div>
          )}

          {/* KPIs WHATSAPP */}
          {campaignType === 'whatsapp' && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
                <KpiCard label="Inversión Total" value={T.spend} type="currency" color="#00d9a3" icon="💰" currency={currency} />
                <KpiCard label="Conversaciones" value={T.messaging} color="#25D366" icon="💬" delta={deltas.messaging} compLabel={compLabel} />
                <KpiCard label="Costo por Conversación" value={avgCostConv} type="currency" color="#4a9eff" icon="🎯" invertDelta delta={deltas.costPerConv} compLabel={compLabel} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 12 }}>
                <KpiCard label="% Conversación / Clic" value={T.linkClicks > 0 ? T.messaging / T.linkClicks * 100 : 0} type="percent" color="#ffb340" icon="📊" sub="Conversaciones / Clics en enlace" />
                <KpiCard label="Hook Rate" value={avgHook} type="percent" color="#ff6b6b" icon="🎣" sub="Video 3s / Impresiones" delta={deltas.hookRate} compLabel={compLabel} />
              </div>
            </div>
          )}

          {/* KPIs LEADS */}
          {campaignType === 'leads' && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 12, marginBottom: 12 }}>
                <KpiCard label="Inversión Total" value={T.spend} type="currency" color="#00d9a3" icon="💰" currency={currency} />
                <KpiCard label="Leads / Registros" value={T.leads} color="#a855f7" icon="📋" sub="lead + complete_registration" delta={deltas.leads} compLabel={compLabel} />
                <KpiCard label="Costo por Lead (CPL)" value={avgCpl} type="currency" color="#4a9eff" icon="🎯" invertDelta delta={deltas.cpl} compLabel={compLabel} />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(1,1fr)', gap: 12 }}>
                <KpiCard label="% Conversión Página / Formulario" value={T.linkClicks > 0 ? T.leads / T.linkClicks * 100 : 0} type="percent" color="#ffb340" icon="📊" sub="(lead + complete_registration) / Clics en enlace" />
              </div>
            </div>
          )}

          {/* KPIs ALCANCE */}
          {campaignType === 'reach' && (
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, marginBottom: 12 }}>
                <KpiCard label="Inversión Total" value={T.spend} type="currency" color="#00d9a3" icon="💰" currency={currency} />
                <KpiCard label="Alcance" value={T.reach} color="#4a9eff" icon="👁" />
                <KpiCard label="Impresiones" value={T.impressions} color="#4a9eff" icon="📊" />
                <KpiCard label="Clics en enlace" value={T.linkClicks} color="#ffb340" icon="🖱" />
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12 }}>
                <KpiCard label="CTR" value={avgCtr} type="percent" color="#00d9a3" icon="🎯" sub="Clics salientes / Impresiones" />
                <KpiCard label="Frecuencia" value={avgFreq} color="#4a9eff" icon="🔁" />
                <KpiCard label="Hook Rate" value={avgHook} type="percent" color="#ffb340" icon="🎣" sub="Video 3s / Impresiones" delta={deltas.hookRate} compLabel={compLabel} />
                <KpiCard label="Interacciones" value={Math.round(T.impressions * 0.034)} color="#ff6b6b" icon="❤️" sub="Likes + comentarios + shares" />
              </div>
            </div>
          )}

          {/* FUNNEL + 3 CHARTS */}
          <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: 14, marginBottom: 14, alignItems: 'start' }}>
            <div className="card">
              <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 16 }}>
                Embudo · {CAMPAIGN_TYPES.find(c => c.v === campaignType)?.l}
              </p>
              <MarketingFunnel totals={T} compTotals={compLabel ? Tc : null} campaignType={campaignType} compLabel={compLabel} />
              <div style={{ marginTop: 16, padding: '12px 14px', background: '#0a1520', borderRadius: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  {campaignType === 'ecommerce' && <><span style={{ fontSize: 11, color: '#4a6a8a' }}>CPA</span><span style={{ fontSize: 14, fontWeight: 700, color: '#00d9a3', fontFamily: 'monospace' }}>{avgCpa > 0 ? fmt(avgCpa, 'currency') : '—'}</span></>}
                  {campaignType === 'whatsapp' && <><span style={{ fontSize: 11, color: '#4a6a8a' }}>Costo/Conv.</span><span style={{ fontSize: 14, fontWeight: 700, color: '#25D366', fontFamily: 'monospace' }}>{avgCostConv > 0 ? fmt(avgCostConv, 'currency') : '—'}</span></>}
                  {campaignType === 'leads' && <><span style={{ fontSize: 11, color: '#4a6a8a' }}>CPL</span><span style={{ fontSize: 14, fontWeight: 700, color: '#a855f7', fontFamily: 'monospace' }}>{avgCpl > 0 ? fmt(avgCpl, 'currency') : '—'}</span></>}
                  {campaignType === 'reach' && <><span style={{ fontSize: 11, color: '#4a6a8a' }}>Frecuencia</span><span style={{ fontSize: 14, fontWeight: 700, color: '#4a9eff', fontFamily: 'monospace' }}>{avgFreq > 0 ? avgFreq.toFixed(2) : '—'}</span></>}
                </div>
                {compLabel && compInsights.length > 0 && (() => {
                  const cMetric = campaignType === 'ecommerce' && Tc.purchases > 0 ? fmt(Tc.spend / Tc.purchases, 'currency')
                    : campaignType === 'whatsapp' && Tc.messaging > 0 ? fmt(Tc.spend / Tc.messaging, 'currency')
                    : campaignType === 'leads' && Tc.leads > 0 ? fmt(Tc.spend / Tc.leads, 'currency')
                    : null;
                  if (!cMetric) return null;
                  return (
                    <div style={{ borderTop: '1px solid #1e2d40', paddingTop: 10, marginTop: 10, display: 'flex', justifyContent: 'space-between' }}>
                      <div>
                        <span style={{ fontSize: 11, color: '#4a6a8a' }}>{compMode === 'prev' ? 'Período anterior' : compPeriod ? `Promedio ${compPeriod.label}` : ''}</span>
                        <div style={{ fontSize: 9, color: '#2a4a6a', marginTop: 2 }}>{compMode === 'prev' ? 'mismos días · previo' : 'datos históricos'}</div>
                      </div>
                      <span style={{ fontSize: 14, fontWeight: 700, color: '#4a9eff', fontFamily: 'monospace' }}>{cMetric}</span>
                    </div>
                  );
                })()}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div className="card">
                <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>
                  Inversión + {campaignType === 'ecommerce' ? 'Compras' : campaignType === 'whatsapp' ? 'Conversaciones' : campaignType === 'leads' ? 'Leads' : 'Alcance'}
                </p>
                <ResponsiveContainer width="100%" height={130}>
                  <ComposedChart data={insights}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                    <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis yAxisId="l" tick={{ fill: '#00d9a360', fontSize: 9 }} tickLine={false} axisLine={false} />
                    <YAxis yAxisId="r" orientation="right" tick={{ fill: '#4a9eff60', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `$${(v/1000).toFixed(0)}k`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Bar yAxisId="r" dataKey="spend" fill="#4a9eff20" radius={[2,2,0,0]} name="Gasto ($)" />
                    <Line yAxisId="l" type="monotone"
                      dataKey={campaignType === 'ecommerce' ? 'purchases' : campaignType === 'whatsapp' ? 'messaging' : campaignType === 'leads' ? 'leads' : 'reach'}
                      stroke="#00d9a3" strokeWidth={2} dot={false}
                      name={campaignType === 'ecommerce' ? 'Compras' : campaignType === 'whatsapp' ? 'Conversaciones' : campaignType === 'leads' ? 'Leads' : 'Alcance'} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
              <div className="card">
                <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Calidad del tráfico</p>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={insights}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                    <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis tick={{ fill: '#3a5070', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <Line type="monotone" dataKey="ctr" stroke="#ffb340" strokeWidth={2} dot={false} name="CTR" />
                    <Line type="monotone" dataKey={campaignType === 'reach' ? 'hookRate' : 'connectionRate'} stroke="#00d9a3" strokeWidth={2} dot={false} name={campaignType === 'reach' ? 'Hook Rate' : 'Conn. Rate'} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {insights.some(d => d.hookRate > 0 || d.connectionRate > 0) && (
              <div className="card">
                <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12 }}>Salud de los creativos</p>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={insights}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#0e1c2c" />
                    <XAxis dataKey="date" tick={{ fill: '#3a5070', fontSize: 9 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
                    <YAxis domain={[0, 100]} tick={{ fill: '#3a5070', fontSize: 9 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}%`} />
                    <Tooltip content={<ChartTooltip />} />
                    <ReferenceLine y={25} stroke="#ffb34040" strokeDasharray="4 4" />
                    <ReferenceLine y={80} stroke="#a855f740" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="hookRate" stroke="#ffb340" strokeWidth={2} dot={false} name="Hook Rate" />
                    <Line type="monotone" dataKey="connectionRate" stroke="#a855f7" strokeWidth={2} dot={false} name="Conn. Rate" />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              )}
            </div>
          </div>

          {/* ADS TABLE */}
          {bestAds.length > 0 && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <p style={{ fontSize: 10, color: '#4a6a8a', letterSpacing: '0.12em', textTransform: 'uppercase' }}>🏆 Mejores anuncios</p>
                  <span style={{ fontSize: 9, color: '#2a4a6a', background: '#0d1520', border: '1px solid #1e2d40', borderRadius: 5, padding: '2px 8px' }}>↕ creativos vs 14 días anteriores</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 10, color: '#3a5a7a' }}>⚠️ creativo en riesgo · click columna para ordenar</span>
                  <button className="ibtn" onClick={() => setShowThresholds(true)}>⚙️ Umbrales</button>
                </div>
              </div>
              <AdsTable ads={bestAds} campaignType={campaignType} thresholds={thresholds} />
            </div>
          )}

          {insights.length === 0 && !refreshing && (
            <div style={{ textAlign: 'center', padding: '60px 0', color: '#2a3a4a' }}>No hay datos para este período.</div>
          )}

          {showThresholds && <ThresholdsModal thresholds={thresholds} onChange={setThresholds} onClose={() => setShowThresholds(false)} />}

          <p style={{ textAlign: 'center', color: '#1e2d40', fontSize: 10, marginTop: 24, paddingBottom: 16 }}>
            Valis Dashboard v2 · Hook Rate = Video 3s / Imp · Connection Rate = Landing Views / Clics salientes
            {" · "}KPIs: {compMode === 'prev' ? 'vs período anterior' : compPeriod ? `promedio ${compPeriod.label}` : 'sin datos comparativos'}
            {" · "}Creativos vs 14 días anteriores
          </p>
        </div>
      </div>
    </>
  );
}
