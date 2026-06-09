/**
 * Port of ChartFactory.java — builds Chart.js 4.x config from SQL results.
 * Returns a JSON string (same format as Java's ChartResult.chartJson).
 */

const SOLID = [
  '#4f6ef7','#10b981','#f59e0b','#ef4444','#8b5cf6',
  '#06b6d4','#f97316','#ec4899','#14b8a6','#84cc16',
];
const ALPHA = [
  'rgba(79,110,247,0.75)','rgba(16,185,129,0.75)','rgba(245,158,11,0.75)',
  'rgba(239,68,68,0.75)','rgba(139,92,246,0.75)','rgba(6,182,212,0.75)',
  'rgba(249,115,22,0.75)','rgba(236,72,153,0.75)','rgba(20,184,166,0.75)',
  'rgba(132,204,22,0.75)',
];

function header(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ').trim();
}

function isNum(col: string, rows: Record<string, unknown>[]): boolean {
  const val = rows.find(r => r[col] !== null && r[col] !== undefined)?.[col];
  return typeof val === 'number';
}

function labelCol(columns: string[], rows: Record<string, unknown>[]): string | null {
  return columns.find(c => {
    const v = rows.find(r => r[c] !== null)?.[c];
    return v !== undefined && typeof v !== 'number';
  }) ?? null;
}

function numericCols(columns: string[], rows: Record<string, unknown>[], excl: Set<string>): string[] {
  return columns.filter(c => !excl.has(c) && isNum(c, rows));
}

function labelsArray(rows: Record<string, unknown>[], col: string): string[] {
  return rows.map(r => r[col] != null ? String(r[col]) : '');
}

function dataArray(rows: Record<string, unknown>[], col: string): number[] {
  return rows.map(r => {
    const v = r[col];
    return typeof v === 'number' ? Math.round(v * 100) / 100 : 0;
  });
}

function paletteArray(size: number, palette: string[]): string[] {
  return Array.from({ length: size }, (_, i) => palette[i % palette.length]);
}

function buildBar(rows: Record<string, unknown>[], labelColumn: string, valueCols: string[]): string {
  const labels = labelsArray(rows, labelColumn);
  const max = Math.min(valueCols.length, 3);
  const datasets = Array.from({ length: max }, (_, i) => {
    const col = valueCols[i];
    const ds: Record<string, unknown> = {
      label: header(col),
      data: dataArray(rows, col),
      borderWidth: 1,
      borderRadius: 3,
    };
    if (max === 1) {
      ds.backgroundColor = Array.from({ length: rows.length }, (_, j) => ALPHA[j % ALPHA.length]);
      ds.borderColor     = Array.from({ length: rows.length }, (_, j) => SOLID[j % SOLID.length]);
    } else {
      ds.backgroundColor = ALPHA[i % ALPHA.length];
      ds.borderColor     = SOLID[i % SOLID.length];
    }
    return ds;
  });
  return JSON.stringify({ type: 'bar', data: { labels, datasets } }, null, 2);
}

function buildLine(rows: Record<string, unknown>[], labelColumn: string, valueCol: string): string {
  const ds = {
    label: header(valueCol),
    data: dataArray(rows, valueCol),
    borderColor: SOLID[0],
    backgroundColor: 'rgba(79,110,247,0.12)',
    fill: true,
    tension: 0.35,
    pointRadius: 3,
  };
  return JSON.stringify({ type: 'line', data: { labels: labelsArray(rows, labelColumn), datasets: [ds] } }, null, 2);
}

function buildPie(rows: Record<string, unknown>[], labelColumn: string, valueCol: string, type: string): string {
  const ds = {
    data: dataArray(rows, valueCol),
    backgroundColor: Array.from({ length: rows.length }, (_, i) => ALPHA[i % ALPHA.length]),
    borderColor:     Array.from({ length: rows.length }, (_, i) => SOLID[i % SOLID.length]),
    borderWidth: 1,
  };
  return JSON.stringify({ type, data: { labels: labelsArray(rows, labelColumn), datasets: [ds] } }, null, 2);
}

export function createChart(
  columns: string[],
  rows: Record<string, unknown>[],
  requestedType?: string | null
): string | null {
  if (!columns.length || !rows.length) return null;
  if (rows.length > 40) return null;

  let labelColumn: string | null;
  let nums: string[];

  if (columns.includes('period')) {
    labelColumn = 'period';
    nums = numericCols(columns, rows, new Set(['period']));
  } else if (columns.includes('segment')) {
    labelColumn = 'segment';
    nums = numericCols(columns, rows, new Set(['segment']));
  } else {
    labelColumn = labelCol(columns, rows);
    nums = numericCols(columns, rows, labelColumn ? new Set([labelColumn]) : new Set());
  }

  if (!labelColumn || !nums.length) return null;

  if (requestedType) {
    switch (requestedType.toLowerCase()) {
      case 'pie':      return buildPie(rows, labelColumn, nums[0], 'pie');
      case 'doughnut': return buildPie(rows, labelColumn, nums[0], 'doughnut');
      case 'line':     return buildLine(rows, labelColumn, nums[0]);
      default:         return buildBar(rows, labelColumn, nums);
    }
  }

  if (columns.includes('period')) {
    const num = nums[0];
    return num ? buildLine(rows, 'period', num) : null;
  }
  if (columns.includes('segment')) return buildBar(rows, 'segment', nums);
  if (rows.length <= 6 && nums.length === 1) return buildPie(rows, labelColumn, nums[0], 'pie');
  return buildBar(rows, labelColumn, nums);
}

/** Reorder labels and parallel data arrays in an existing Chart.js config JSON. */
export function applyVisualChange(
  chartJson: string,
  change: { sort?: { by: 'value' | 'label'; direction: 'asc' | 'desc'; datasetIndex?: number } }
): string {
  let cfg: Record<string, unknown>;
  try { cfg = JSON.parse(chartJson); } catch { return chartJson; }

  const data = cfg.data as Record<string, unknown> | undefined;
  if (!data) return chartJson;

  const labels   = data.labels as unknown[];
  const datasets = data.datasets as Array<Record<string, unknown>>;
  if (!Array.isArray(labels) || !Array.isArray(datasets)) return chartJson;

  const n = labels.length;
  if (!n || !change.sort) return chartJson;

  const { by, direction, datasetIndex = 0 } = change.sort;
  const asc = direction === 'asc';
  const primaryDs = datasets[Math.min(datasetIndex, datasets.length - 1)];
  const primaryData = Array.isArray(primaryDs?.data) ? primaryDs.data as number[] : [];

  const indices = Array.from({ length: n }, (_, i) => i);
  indices.sort((a, b) => {
    if (by === 'label') {
      const la = String(labels[a] ?? '');
      const lb = String(labels[b] ?? '');
      return asc ? la.localeCompare(lb) : lb.localeCompare(la);
    }
    const va = typeof primaryData[a] === 'number' ? primaryData[a] : 0;
    const vb = typeof primaryData[b] === 'number' ? primaryData[b] : 0;
    return asc ? va - vb : vb - va;
  });

  data.labels = indices.map(i => labels[i]);
  for (const ds of datasets) {
    if (!Array.isArray(ds.data)) continue;
    const old = ds.data as unknown[];
    ds.data = indices.map(i => (i < old.length ? old[i] : 0));
    // reorder backgroundColor/borderColor arrays if they are per-item arrays
    for (const key of ['backgroundColor', 'borderColor']) {
      if (Array.isArray(ds[key])) {
        const arr = ds[key] as unknown[];
        ds[key] = indices.map(i => (i < arr.length ? arr[i] : arr[0]));
      }
    }
  }

  return JSON.stringify(cfg, null, 2);
}
