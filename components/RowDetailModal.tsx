'use client';

import React, { useState } from 'react';
import type { ColumnDef } from '@/lib/types';

interface RowDetailModalProps {
  row: Record<string, unknown> | null;
  columns: ColumnDef[];
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

export default function RowDetailModal({ row, columns, preAggRows, groupByFields, onClose }: RowDetailModalProps) {
  const [drillIdx, setDrillIdx] = useState(0);

  if (!row) return null;

  // Determine if we have drilldown context (aggregated row)
  const hasDrilldown = preAggRows.length > 0 && groupByFields.length > 0;

  // Find matching source records for this aggregated row
  const matchingRows = hasDrilldown
    ? preAggRows.filter(pr => groupByFields.every(f => pr[f] === row[f]))
    : [];

  const showDrilldown = hasDrilldown && matchingRows.length > 0;
  const drillRow = showDrilldown ? matchingRows[Math.min(drillIdx, matchingRows.length - 1)] : null;

  const displayRow = showDrilldown && drillRow ? drillRow : row;
  const entries = Object.entries(displayRow);

  const isCurrencyField = (field: string): boolean =>
    columns.find(c => c.field === field)?.currency ?? false;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-title">Record Details</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        {showDrilldown && (
          <>
            <div className="drilldown-header">
              Showing source records for: {groupByFields.map(f => `${formatFieldName(f)}: ${row[f]}`).join(', ')}
            </div>
            <div className="drilldown-nav">
              <button
                className="drilldown-nav-btn"
                disabled={drillIdx === 0}
                onClick={() => setDrillIdx(i => Math.max(0, i - 1))}
              >‹ Prev</button>
              <select
                className="drilldown-select"
                value={drillIdx}
                onChange={e => setDrillIdx(Number(e.target.value))}
              >
                {matchingRows.map((_, i) => (
                  <option key={i} value={i}>Record {i + 1}</option>
                ))}
              </select>
              <button
                className="drilldown-nav-btn"
                disabled={drillIdx >= matchingRows.length - 1}
                onClick={() => setDrillIdx(i => Math.min(matchingRows.length - 1, i + 1))}
              >Next ›</button>
              <span className="drilldown-of">{drillIdx + 1} of {matchingRows.length}</span>
            </div>
          </>
        )}

        {!showDrilldown && (
          <div className="row-detail-body">
            {Object.entries(row).map(([key, val]) => (
              <div className="row-detail-row" key={key}>
                <span className="row-detail-key">{formatFieldName(key)}</span>
                <span className="row-detail-val">{formatValue(val, isCurrencyField(key))}</span>
              </div>
            ))}
          </div>
        )}

        {showDrilldown && (
          <div className="row-detail-body drilldown-record">
            {entries.map(([key, val]) => (
              <div className="row-detail-row" key={key}>
                <span className="row-detail-key">{formatFieldName(key)}</span>
                <span className="row-detail-val">{formatValue(val, isCurrencyField(key))}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
