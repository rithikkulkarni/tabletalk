'use client';

import React, { useMemo, useState, useCallback } from 'react';
import {
  useReactTable, getCoreRowModel, getSortedRowModel,
  getFilteredRowModel, flexRender,
  type ColumnDef as TColumnDef, type SortingState,
} from '@tanstack/react-table';
import type { ColumnDef, SortEntry } from '@/lib/types';

interface DataGridProps {
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
  sortEntries: SortEntry[];
  onSortChange: (sort: SortEntry[]) => void;
  onColumnReorder: (from: number, to: number) => void;
  onRowClick: (row: Record<string, unknown>) => void;
  isAnalysisView: boolean;
}

function formatCurrency(val: unknown): string {
  const n = typeof val === 'number' ? val : parseFloat(String(val ?? ''));
  if (isNaN(n)) return String(val ?? '');
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
}

function formatValue(val: unknown, isCurrency: boolean): string {
  if (val === null || val === undefined) return '';
  if (isCurrency && typeof val === 'number') return formatCurrency(val);
  return String(val);
}

function getColumnFooter(rows: Record<string, unknown>[], col: ColumnDef): string | null {
  if (!col.numeric) return null;
  const total = rows.reduce((sum, r) => {
    const v = r[col.field];
    return sum + (typeof v === 'number' ? v : 0);
  }, 0);
  return col.currency ? formatCurrency(total) : total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function DataGrid({
  columns, rows, sortEntries, onSortChange, onColumnReorder, onRowClick, isAnalysisView,
}: DataGridProps) {
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [dragFrom, setDragFrom] = useState<number | null>(null);

  const visibleCols = useMemo(() => columns.filter(c => c.visible), [columns]);

  const filteredRows = useMemo(() => {
    return rows.filter(row => {
      return Object.entries(columnFilters).every(([field, filterVal]) => {
        if (!filterVal) return true;
        const v = row[field];
        return v !== null && v !== undefined &&
               String(v).toLowerCase().includes(filterVal.toLowerCase());
      });
    });
  }, [rows, columnFilters]);

  const sorting: SortingState = useMemo(() =>
    sortEntries.map(s => ({ id: s.field, desc: s.direction === 'desc' })),
    [sortEntries]
  );

  const tableCols = useMemo<TColumnDef<Record<string, unknown>>[]>(() => {
    const actionCol: TColumnDef<Record<string, unknown>> = {
      id: '_action',
      header: '',
      size: 36,
      cell: ({ row }) => (
        <button
          className="row-view-btn"
          title="View record details"
          onClick={() => onRowClick(row.original)}
        >⊞</button>
      ),
      enableSorting: false,
    };

    const dataCols: TColumnDef<Record<string, unknown>>[] = visibleCols.map(col => ({
      id: col.field,
      accessorKey: col.field,
      header: col.headerText,
      cell: ({ getValue }) => formatValue(getValue(), col.currency),
      footer: () => getColumnFooter(filteredRows, col),
      enableSorting: true,
      sortingFn: (a, b) => {
        const av = a.original[col.field];
        const bv = b.original[col.field];
        if (av === null || av === undefined) return -1;
        if (bv === null || bv === undefined) return 1;
        if (typeof av === 'number' && typeof bv === 'number') return av - bv;
        return String(av).localeCompare(String(bv));
      },
    }));

    return [actionCol, ...dataCols];
  }, [visibleCols, filteredRows, onRowClick]);

  const table = useReactTable({
    data: filteredRows,
    columns: tableCols,
    state: { sorting },
    onSortingChange: (updater) => {
      const next = typeof updater === 'function' ? updater(sorting) : updater;
      onSortChange(next.map(s => ({ field: s.id, direction: s.desc ? 'desc' : 'asc' })));
    },
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    manualSorting: false,
  });

  const exportCSV = useCallback(() => {
    const header = visibleCols.map(c => c.headerText).join(',');
    const body = filteredRows.map(r =>
      visibleCols.map(c => {
        const v = r[c.field];
        const s = v === null || v === undefined ? '' : String(v).replace(/"/g, '""');
        return `"${s}"`;
      }).join(',')
    ).join('\n');
    const blob = new Blob([header + '\n' + body], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'export.csv'; a.click();
    URL.revokeObjectURL(url);
  }, [filteredRows, visibleCols]);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    setDragFrom(idx);
    e.dataTransfer.effectAllowed = 'move';
  };
  const handleDragOver = (e: React.DragEvent) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  const handleDrop = (e: React.DragEvent, toIdx: number) => {
    e.preventDefault();
    if (dragFrom !== null && dragFrom !== toIdx) onColumnReorder(dragFrom, toIdx);
    setDragFrom(null);
  };

  return (
    <div>
      <div className="table-action-bar">
        <div className="export-bar">
          <span className="export-label">Export:</span>
          <button className="export-btn ghost-btn" onClick={exportCSV}>CSV</button>
        </div>
      </div>
      <p className="grid-hint">
        Click column headers to sort · Drag headers to reorder · Filter in the boxes below headers
        {isAnalysisView && ' · Showing query results'}
      </p>
      <div className="table-wrapper">
        <table>
          <thead>
            {table.getHeaderGroups().map(hg => (
              <tr key={hg.id}>
                {hg.headers.map((header, idx) => {
                  const isData = header.id !== '_action';
                  const colIdx = idx - 1; // offset for action col
                  return (
                    <th
                      key={header.id}
                      style={{ width: header.getSize() }}
                      draggable={isData}
                      onDragStart={isData ? (e) => handleDragStart(e, colIdx) : undefined}
                      onDragOver={isData ? handleDragOver : undefined}
                      onDrop={isData ? (e) => handleDrop(e, colIdx) : undefined}
                      className={header.column.getCanSort() ? 'sortable' : ''}
                      onClick={isData ? header.column.getToggleSortingHandler() : undefined}
                    >
                      <div className="th-content">
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' && <span className="sort-icon">↑</span>}
                        {header.column.getIsSorted() === 'desc' && <span className="sort-icon">↓</span>}
                      </div>
                      {isData && (
                        <input
                          className="col-filter"
                          placeholder="Filter…"
                          value={columnFilters[header.id] ?? ''}
                          onChange={e => setColumnFilters(prev => ({ ...prev, [header.id]: e.target.value }))}
                          onClick={ev => ev.stopPropagation()}
                        />
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row, i) => (
              <tr key={row.id} className={i % 2 === 1 ? 'even-row' : ''}>
                {row.getVisibleCells().map(cell => (
                  <td key={cell.id}>
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              {table.getFooterGroups()[0]?.headers.map(h => (
                <td key={h.id}>
                  {h.column.columnDef.footer
                    ? flexRender(h.column.columnDef.footer, h.getContext())
                    : null}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
      <div className="table-meta">{filteredRows.length} of {rows.length} rows</div>
    </div>
  );
}
