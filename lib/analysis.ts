/**
 * Port of AnalysisService.java — in-memory SQL engine using better-sqlite3.
 * API and logic are identical to the Java version; only the DB driver changes.
 */
import type { Step, StepCondition, StepAggregation, ColumnDef } from './types';

// better-sqlite3 is a native module — only import on the server side.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.pragma('journal_mode = WAL');

// ── Table management ──────────────────────────────────────────────────────────

export function ensureTable(tableId: string, rows: Record<string, unknown>[]): void {
  if (!rows.length) return;
  const sample = rows[0];
  const cols = Object.keys(sample);

  db.exec(`DROP TABLE IF EXISTS "${tableId.replace(/"/g, '""')}"`);

  const defs = cols.map(c => {
    const v = sample[c];
    const type = typeof v === 'number' ? 'REAL' : 'TEXT';
    return `"${c.replace(/"/g, '""')}" ${type}`;
  });
  db.exec(`CREATE TABLE "${tableId.replace(/"/g, '""')}" (${defs.join(', ')})`);

  const placeholders = cols.map(() => '?').join(', ');
  const stmt = db.prepare(
    `INSERT INTO "${tableId.replace(/"/g, '""')}" VALUES (${placeholders})`
  );
  const insertMany = db.transaction((rowList: Record<string, unknown>[]) => {
    for (const row of rowList) {
      stmt.run(cols.map(c => {
        const val = row[c];
        if (val === null || val === undefined) return null;
        if (typeof val === 'number') return val;
        return String(val);
      }));
    }
  });
  insertMany(rows);
}

export function executeQuery(sql: string): Record<string, unknown>[] {
  return db.prepare(sql).all() as Record<string, unknown>[];
}

// ── SQL builder — faithful port of AnalysisService.java ──────────────────────

export function buildStepSql(step: Step, source: string): string {
  switch (step.op) {
    case 'filter':     return buildFilterSql(step, source);
    case 'groupBy':    return buildGroupBySql(step, source);
    case 'sort':       return buildSortSql(step, source);
    case 'select':     return buildSelectSql(step, source);
    case 'topN':       return buildTopNSql(step, source);
    case 'distinct':   return buildDistinctSql(step, source);
    case 'timeSeries': return buildTimeSeriesSql(step, source);
    case 'compare':    return buildCompareSql(step, source);
    case 'pivot':      return buildPivotFallbackSql(step, source);
    default:           throw new Error(`Unknown op: ${step.op}`);
  }
}

function buildFilterSql(step: Step, source: string): string {
  const conditions = step.conditions ?? [];
  const logic = step.logic ?? 'AND';
  const conds = conditions.map(buildConditionSql);
  const where = conds.length ? ` WHERE ${conds.join(` ${logic} `)}` : '';
  return `SELECT * FROM ${source}${where}`;
}

function buildGroupBySql(step: Step, source: string): string {
  const groupCols = step.columns ?? [];
  const aggs = step.aggregations ?? [];

  const selects = [
    ...groupCols.map(quoteName),
    ...aggs.map(buildAggSql),
  ];

  let sql = `SELECT ${selects.length ? selects.join(', ') : '*'} FROM ${source}`;
  if (groupCols.length) sql += ` GROUP BY ${groupCols.map(quoteName).join(', ')}`;
  if (step.sort) {
    const dir = step.sort.direction?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
    sql += ` ORDER BY ${quoteName(step.sort.column)} ${dir}`;
  }
  if (step.limit != null) sql += ` LIMIT ${Math.max(1, step.limit)}`;
  return sql;
}

function buildSortSql(step: Step, source: string): string {
  const by = step.by ?? [];
  const parts = by.map(b => {
    const dir = b.direction?.toUpperCase() === 'DESC' ? 'DESC' : 'ASC';
    return `${quoteName(b.column)} ${dir}`;
  });
  let sql = `SELECT * FROM ${source}`;
  if (parts.length) sql += ` ORDER BY ${parts.join(', ')}`;
  if (step.limit != null) sql += ` LIMIT ${Math.max(1, step.limit)}`;
  return sql;
}

function buildSelectSql(step: Step, source: string): string {
  const cols = step.columns ?? [];
  const cs = cols.map(quoteName);
  return `SELECT ${cs.length ? cs.join(', ') : '*'} FROM ${source}`;
}

function buildTopNSql(step: Step, source: string): string {
  const dir = step.direction?.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const n   = step.n != null ? Math.max(1, step.n) : 10;
  return `SELECT * FROM ${source} ORDER BY ${quoteName(step.column!)} ${dir} LIMIT ${n}`;
}

function buildDistinctSql(step: Step, source: string): string {
  const cols = step.columns ?? [];
  const cs = cols.map(quoteName);
  const colSql = cs.length ? cs.join(', ') : '*';
  return `SELECT DISTINCT ${colSql} FROM ${source} ORDER BY ${colSql}`;
}

function buildTimeSeriesSql(step: Step, source: string): string {
  const validGran = ['day','week','month','quarter','year'];
  let gran = 'month';
  if (step.granularity && validGran.includes(step.granularity)) gran = step.granularity;
  const aggs = (step.aggregations ?? []).map(buildAggSql);
  const dateCol = quoteName(step.dateColumn!);
  // SQLite uses strftime; approximate DATE_TRUNC
  const trunc = (() => {
    switch (gran) {
      case 'day':     return `date(${dateCol})`;
      case 'week':    return `date(${dateCol}, 'weekday 1', '-6 days')`;
      case 'month':   return `strftime('%Y-%m-01', ${dateCol})`;
      case 'quarter': return `strftime('%Y-', ${dateCol}) || CASE CAST(strftime('%m', ${dateCol}) AS INTEGER) WHEN 1 THEN '01' WHEN 2 THEN '01' WHEN 3 THEN '01' WHEN 4 THEN '04' WHEN 5 THEN '04' WHEN 6 THEN '04' WHEN 7 THEN '07' WHEN 8 THEN '07' WHEN 9 THEN '07' ELSE '10' END || '-01'`;
      case 'year':    return `strftime('%Y-01-01', ${dateCol})`;
      default:        return `strftime('%Y-%m-01', ${dateCol})`;
    }
  })();
  return `SELECT ${trunc} AS "period"${aggs.length ? ', ' + aggs.join(', ') : ''} FROM ${source} GROUP BY "period" ORDER BY "period" ASC`;
}

function buildCompareSql(step: Step, source: string): string {
  const segs    = step.segments ?? [];
  const metrics = step.metrics ?? [];
  const metricSqls = metrics.map(buildAggSql);
  const metricStr = metricSqls.length ? metricSqls.join(', ') : 'COUNT(*) AS "count"';

  const parts = segs.map(seg => {
    const conds = (seg.conditions ?? []).map(buildConditionSql);
    const logic = seg.logic ?? 'AND';
    const where = conds.length ? ` WHERE ${conds.join(` ${logic} `)}` : '';
    return `SELECT ${quoteLiteralStr(seg.label)} AS "segment", ${metricStr} FROM ${source}${where}`;
  });
  return parts.join('\nUNION ALL\n');
}

function buildPivotFallbackSql(step: Step, source: string): string {
  const rowCol = step.rowColumn ? quoteName(step.rowColumn) : '*';
  const colCol = step.colColumn ? quoteName(step.colColumn) : '*';
  const fn  = (step.fn ?? 'COUNT').toUpperCase();
  const agg = step.valueColumn && fn !== 'COUNT'
    ? `${fn}(${quoteName(step.valueColumn)}) AS "value"`
    : 'COUNT(*) AS "count"';
  return `SELECT ${rowCol}, ${colCol}, ${agg} FROM ${source} GROUP BY ${rowCol}, ${colCol} ORDER BY ${rowCol}, ${colCol}`;
}

// ── Condition SQL ─────────────────────────────────────────────────────────────

function normalizeOp(raw: string): string {
  if (!raw) return 'eq';
  const k = raw.toLowerCase().replace(/[_\-\s]/g, '');
  switch (k) {
    case 'eq': case 'equals': case 'equal': case 'is': case '==': return 'eq';
    case 'ne': case 'neq': case 'notequal': case 'notequals': case 'isnot': case '!=': return 'ne';
    case 'gt': case 'greaterthan': case 'greater': case 'above': case '>': return 'gt';
    case 'lt': case 'lessthan': case 'less': case 'below': case '<': return 'lt';
    case 'gte': case 'greaterorequal': case 'greaterthanorequal': case '>=': return 'gte';
    case 'lte': case 'lessorequal': case 'lessthanorequal': case '<=': return 'lte';
    case 'in': case 'oneof': case 'isoneof': case 'isin': case 'anyin': case 'any': return 'in';
    case 'notin': case 'notinlist': case 'notinoneof': case 'nin': return 'not_in';
    case 'contains': case 'include': case 'includes': case 'ilike': case 'like': case 'matches': return 'contains';
    case 'startswith': case 'beginswith': case 'startingwith': return 'starts_with';
    case 'endswith': case 'endingwith': return 'ends_with';
    case 'between': case 'inrange': case 'range': return 'between';
    case 'isnull': case 'null': case 'isblank': case 'blank': case 'empty': return 'is_null';
    case 'notnull': case 'isnotnull': case 'notblank': case 'isnotblank': case 'notempty': return 'not_null';
    default: return raw;
  }
}

function buildConditionSql(cond: StepCondition): string {
  const col = quoteName(cond.column);
  const op  = normalizeOp(cond.op);
  const val = cond.value;

  switch (op) {
    case 'eq':         return `${col} = ${quoteLiteral(val)}`;
    case 'ne':         return `${col} != ${quoteLiteral(val)}`;
    case 'gt':         return `${col} > ${quoteLiteral(val)}`;
    case 'lt':         return `${col} < ${quoteLiteral(val)}`;
    case 'gte':        return `${col} >= ${quoteLiteral(val)}`;
    case 'lte':        return `${col} <= ${quoteLiteral(val)}`;
    case 'in':         return `${col} IN ${quoteLiteralList(val)}`;
    case 'not_in':     return `${col} NOT IN ${quoteLiteralList(val)}`;
    case 'contains':   return `LOWER(${col}) LIKE LOWER(${quoteLiteralStr('%' + String(val ?? '') + '%')})`;
    case 'starts_with':return `LOWER(${col}) LIKE LOWER(${quoteLiteralStr(String(val ?? '') + '%')})`;
    case 'ends_with':  return `LOWER(${col}) LIKE LOWER(${quoteLiteralStr('%' + String(val ?? ''))})`;
    case 'between': {
      if (Array.isArray(val) && val.length >= 2)
        return `${col} BETWEEN ${quoteLiteral(val[0])} AND ${quoteLiteral(val[1])}`;
      return '1=1';
    }
    case 'is_null':    return `${col} IS NULL`;
    case 'not_null':   return `${col} IS NOT NULL`;
    default:           return '1=1';
  }
}

function buildAggSql(agg: StepAggregation): string {
  const fn    = (agg.fn ?? 'COUNT').toUpperCase();
  const col   = agg.column ?? '*';
  const alias = agg.alias ?? `${fn}_${col}`;
  const colRef = col === '*' ? '*' : quoteName(col);
  const aggExpr = fn === 'COUNT_DISTINCT'
    ? `COUNT(DISTINCT ${colRef})`
    : `${fn}(${colRef})`;
  return `${aggExpr} AS ${quoteName(alias)}`;
}

// ── Quoting helpers ───────────────────────────────────────────────────────────

export function quoteName(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

function quoteLiteral(val: unknown): string {
  if (val === null || val === undefined) return 'NULL';
  if (typeof val === 'number') return String(val);
  if (typeof val === 'boolean') return val ? '1' : '0';
  return `'${String(val).replace(/'/g, "''")}'`;
}

function quoteLiteralStr(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

function quoteLiteralList(val: unknown): string {
  if (!Array.isArray(val)) return "('')";
  const parts = (val as unknown[]).map(quoteLiteral);
  return `(${parts.join(', ')})`;
}

// ── Sort extraction ───────────────────────────────────────────────────────────

export function extractSortFromStep(step: Step): Array<{ field: string; direction: 'asc' | 'desc' }> {
  switch (step.op) {
    case 'sort':
      return (step.by ?? []).map(b => ({
        field: b.column,
        direction: b.direction?.toLowerCase() === 'desc' ? 'desc' : 'asc',
      }));
    case 'groupBy':
      if (!step.sort) return [];
      return [{ field: step.sort.column, direction: step.sort.direction?.toLowerCase() === 'asc' ? 'asc' : 'desc' }];
    case 'topN':
      return [{ field: step.column!, direction: step.direction?.toLowerCase() === 'asc' ? 'asc' : 'desc' }];
    case 'timeSeries':
      return [{ field: 'period', direction: 'asc' }];
    default:
      return [];
  }
}

// ── Step validation ───────────────────────────────────────────────────────────

function getStepColumnRefs(step: Step): string[] {
  const refs: string[] = [];
  switch (step.op) {
    case 'filter':
      (step.conditions ?? []).forEach(c => c.column && refs.push(c.column));
      break;
    case 'groupBy':
      (step.columns ?? []).forEach(c => refs.push(c));
      (step.aggregations ?? []).forEach(a => { if (a.column && a.column !== '*') refs.push(a.column); });
      break;
    case 'sort':
      (step.by ?? []).forEach(b => b.column && refs.push(b.column));
      break;
    case 'select':
    case 'distinct':
      (step.columns ?? []).forEach(c => refs.push(c));
      break;
    case 'topN':
      if (step.column) refs.push(step.column);
      break;
    case 'timeSeries':
      if (step.dateColumn) refs.push(step.dateColumn);
      (step.aggregations ?? []).forEach(a => { if (a.column && a.column !== '*') refs.push(a.column); });
      break;
  }
  return refs;
}

function getStepOutputColumns(step: Step, inputCols: string[]): string[] | null {
  switch (step.op) {
    case 'filter':
    case 'sort':
    case 'topN':
      return [...inputCols];
    case 'select':
    case 'distinct':
      return step.columns ?? [];
    case 'groupBy': {
      const out = [...(step.columns ?? [])];
      (step.aggregations ?? []).forEach(a => {
        out.push(a.alias ?? `${a.fn}_${a.column}`);
      });
      return out;
    }
    case 'timeSeries': {
      const out = ['period'];
      (step.aggregations ?? []).forEach(a => {
        out.push(a.alias ?? `${a.fn}_${a.column}`);
      });
      return out;
    }
    case 'compare': {
      const out = ['segment'];
      (step.metrics ?? []).forEach(m => {
        out.push(m.alias ?? `${m.fn}_${m.column}`);
      });
      return out;
    }
    default:
      return null;
  }
}

export function pruneInvalidSteps(steps: Step[], schema: ColumnDef[]): Step[] {
  let currentCols = new Set(schema.map(c => c.field));
  const valid: Step[] = [];
  for (const step of steps) {
    const refs = getStepColumnRefs(step);
    const missing = refs.filter(r => !currentCols.has(r));
    if (missing.length) continue;
    valid.push(step);
    const next = getStepOutputColumns(step, Array.from(currentCols));
    if (next) currentCols = new Set(next);
  }
  return valid;
}

export function reorderStepPlan(steps: Step[], schema: ColumnDef[]): Step[] {
  const origCols = new Set(schema.map(c => c.field));
  const AGG_OPS = new Set(['groupBy','timeSeries','pivot','compare']);
  const preFilters: Step[] = [];
  const rest: Step[] = [];

  for (const step of steps) {
    if (step.op === 'filter') {
      const refs = getStepColumnRefs(step);
      if (refs.length && refs.every(r => origCols.has(r))) {
        preFilters.push(step);
        continue;
      }
    }
    rest.push(step);
  }

  const hasAgg = rest.some(s => AGG_OPS.has(s.op));
  if (!preFilters.length || !hasAgg) return steps;
  return [...preFilters, ...rest];
}

// ── Summary facts ─────────────────────────────────────────────────────────────

export function computeSummaryFacts(
  columns: string[],
  rows: Record<string, unknown>[],
  steps: Step[]
): Record<string, unknown> {
  const facts: Record<string, unknown> = { resultRowCount: rows.length };

  const distinct: Record<string, number> = {};
  for (const col of columns) {
    const seen = new Set(rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== ''));
    distinct[col] = seen.size;
  }
  facts.distinctCounts = distinct;

  let lastGroupBy: Step | null = null;
  for (let i = steps.length - 1; i >= 0; i--) {
    if (steps[i].op === 'groupBy') { lastGroupBy = steps[i]; break; }
  }

  if (lastGroupBy && rows.length && lastGroupBy.sort) {
    const metricCol = lastGroupBy.sort.column;
    const groupCol  = lastGroupBy.columns?.[0] ?? null;
    if (rows[0]?.[metricCol] !== undefined) {
      facts.groupColumn      = groupCol;
      facts.metricColumn     = metricCol;
      facts.topGroup         = rows[0]?.[groupCol ?? ''];
      facts.topValue         = rows[0]?.[metricCol];
      facts.runnerUpGroup    = rows[1]?.[groupCol ?? ''] ?? null;
      facts.runnerUpValue    = rows[1]?.[metricCol] ?? null;
      facts.distinctGroupCount = groupCol ? (distinct[groupCol] ?? rows.length) : rows.length;
    }
  }

  return facts;
}
