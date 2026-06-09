'use client';

import React, { useState, useEffect } from 'react';
import type { ColumnDef } from '@/lib/types';

interface RowDetailModalProps {
  row: Record<string, unknown> | null;
  columns: ColumnDef[];
  dsColumns: ColumnDef[];
  preAggRows: Record<string, unknown>[];
  groupByFields: string[];
  onClose: () => void;
}

function formatValue(val: unknown, isCurrency: boolean): string {
  if (val === null || val === undefined) return '—';
  if (isCurrency && typeof val === 'number')
    return val.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  return String(val);
}

function formatFieldName(field: string): string {
  const s = field.replace(/([A-Z])/g, ' $1').replace(/_/g,' ').trim();
  if (!s) return field;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export default function RowDetailModal({ row, columns, dsColumns, preAggRows, groupByFields, onClose }: RowDetailModalProps) {
  const [drillIdx, setDrillIdx] = useState(0);

  // Reset to first record whenever the selected row changes
  useEffect(() => { setDrillIdx(0); }, [row]);

  if (!row) return null;

  const hasDrilldown = preAggRows.length > 0 && groupByFields.length > 0;
  const matchingRows = hasDrilldown
    ? preAggRows.filter(pr => groupByFields.every(f => String(pr[f]) === String(row[f])))
    : [];
  const showDrilldown = hasDrilldown && matchingRows.length > 0;
  const safeIdx = Math.min(drillIdx, Math.max(0, matchingRows.length - 1));
  const drillRow = showDrilldown ? matchingRows[safeIdx] : null;

  // Use original dataset columns for drilldown records, aggregated columns otherwise
  const activeCols = showDrilldown ? dsColumns : columns;
  const isCurrencyField = (field: string): boolean =>
    activeCols.find(c => c.field === field)?.currency ?? false;

  const displayRow = drillRow ?? row;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">
            {showDrilldown ? 'Source Record Details' : 'Record Details'}
          </span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {showDrilldown && (
          <>
            <div className="drilldown-header">
              {matchingRows.length} source record{matchingRows.length !== 1 ? 's' : ''} for:{' '}
              {groupByFields.map(f => `${formatFieldName(f)}: ${row[f]}`).join(', ')}
            </div>
            <div className="drilldown-nav">
              <button
                className="drilldown-nav-btn"
                disabled={safeIdx === 0}
                onClick={() => setDrillIdx(i => Math.max(0, i - 1))}
              >‹ Prev</button>
              <select
                className="drilldown-select"
                value={safeIdx}
                onChange={e => setDrillIdx(Number(e.target.value))}
              >
                {matchingRows.map((_, i) => (
                  <option key={i} value={i}>Record {i + 1}</option>
                ))}
              </select>
              <button
                className="drilldown-nav-btn"
                disabled={safeIdx >= matchingRows.length - 1}
                onClick={() => setDrillIdx(i => Math.min(matchingRows.length - 1, i + 1))}
              >Next ›</button>
              <span className="drilldown-of">{safeIdx + 1} of {matchingRows.length}</span>
            </div>
          </>
        )}

        <div className={`row-detail-body${showDrilldown ? ' drilldown-record' : ''}`}>
          {Object.entries(displayRow).map(([key, val]) => (
            <div className="row-detail-row" key={key}>
              <span className="row-detail-key">{formatFieldName(key)}</span>
              <span className="row-detail-val">{formatValue(val, isCurrencyField(key))}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
