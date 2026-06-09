'use client';

import React, { useState, useRef, useCallback } from 'react';
import { Upload, FileText, CheckCircle2 } from 'lucide-react';
import type { DatasetInfo, ColumnDef } from '@/lib/types';

// ── CSV parser ────────────────────────────────────────────────────────────

function parseRow(line: string): string[] {
  const fields: string[] = [];
  let cur = '';
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else { inQ = !inQ; }
    } else if (ch === ',' && !inQ) {
      fields.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  fields.push(cur);
  return fields;
}

function parseCSV(text: string): { headers: string[]; rawRows: string[][] } {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n').filter(l => l.trim());
  if (lines.length < 2) return { headers: [], rawRows: [] };
  return { headers: parseRow(lines[0]), rawRows: lines.slice(1).map(parseRow) };
}

function toFieldName(header: string, seen: Set<string>): string {
  let base = header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'col';
  let name = base; let n = 2;
  while (seen.has(name)) { name = `${base}_${n++}`; }
  seen.add(name);
  return name;
}

function isCurrency(header: string): boolean {
  return /amount|price|cost|total|revenue|value|sales|earning|profit|fee/i.test(header);
}

function buildDataset(filename: string, text: string, existingIds: Set<string>): DatasetInfo | { error: string } {
  const { headers, rawRows } = parseCSV(text);
  if (!headers.length) return { error: 'No headers found — make sure the first row contains column names.' };
  if (!rawRows.length) return { error: 'The file has headers but no data rows.' };

  const seen = new Set<string>();
  const columns: ColumnDef[] = headers.map((h, i) => {
    const field = toFieldName(h, seen);
    const values = rawRows.map(r => r[i]?.trim()).filter(v => v !== '' && v !== undefined);
    const numeric = values.length > 0 && values.every(v => v !== undefined && !isNaN(Number(v)));
    return { field, headerText: h.trim() || field, numeric, currency: numeric && isCurrency(h), visible: true };
  });

  const rows: Record<string, unknown>[] = rawRows.map(r =>
    Object.fromEntries(columns.map((col, i) => {
      const raw = r[i]?.trim() ?? '';
      return [col.field, col.numeric && raw !== '' ? Number(raw) : raw];
    }))
  );

  const label = filename.replace(/\.[^.]+$/, '');
  const baseId = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'import';
  let id = baseId; let n = 2;
  while (existingIds.has(id)) { id = `${baseId}-${n++}`; }

  return { id, label, columns, rows };
}

// ── Component ──────────────────────────────────────────────────────────────

interface CsvImportModalProps {
  existingIds: Set<string>;
  onImport: (ds: DatasetInfo) => void;
  onClose: () => void;
}

interface ParsedFile {
  name: string;
  rows: number;
  cols: number;
  dataset: DatasetInfo;
}

export default function CsvImportModal({ existingIds, onImport, onClose }: CsvImportModalProps) {
  const [dragActive, setDragActive] = useState(false);
  const [parsed, setParsed] = useState<ParsedFile | null>(null);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = useCallback((file: File) => {
    if (!file.name.match(/\.csv$/i)) {
      setError('Only .csv files are supported.');
      setParsed(null);
      return;
    }
    const reader = new FileReader();
    reader.onload = e => {
      const text = e.target?.result as string;
      const result = buildDataset(file.name, text, existingIds);
      if ('error' in result) { setError(result.error); setParsed(null); }
      else { setError(''); setParsed({ name: file.name, rows: result.rows.length, cols: result.columns.length, dataset: result }); }
    };
    reader.readAsText(file);
  }, [existingIds]);

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDragActive(false);
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  };

  const onFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  };

  const handleLoad = () => {
    if (parsed) { onImport(parsed.dataset); onClose(); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content csv-modal-content" onClick={e => e.stopPropagation()}>

        <div className="modal-header">
          <span className="modal-title">Import CSV Dataset</span>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="csv-modal-body">

          {/* Drop zone */}
          <div
            className={`csv-drop-zone${dragActive ? ' csv-drop-zone--active' : ''}${parsed ? ' csv-drop-zone--ready' : ''}`}
            onClick={() => inputRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <input ref={inputRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={onFileInput} />

            {!parsed ? (
              <>
                <div className="csv-drop-icon-wrap">
                  {dragActive
                    ? <FileText size={32} strokeWidth={1.25} />
                    : <Upload size={32} strokeWidth={1.25} />}
                </div>
                <p className="csv-drop-primary">
                  {dragActive ? 'Drop to import' : 'Drag & drop a CSV file here'}
                </p>
                <p className="csv-drop-secondary">or click to browse</p>
              </>
            ) : (
              <>
                <div className="csv-drop-icon-wrap csv-drop-icon-wrap--ready">
                  <CheckCircle2 size={32} strokeWidth={1.25} />
                </div>
                <p className="csv-file-name">{parsed.name}</p>
                <p className="csv-file-stats">{parsed.rows.toLocaleString()} rows · {parsed.cols} columns</p>
                <p className="csv-drop-secondary" style={{ marginTop: 4 }}>Click or drop to replace</p>
              </>
            )}
          </div>

          {error && <p className="status status--error">{error}</p>}

          {/* Column preview */}
          {parsed && (
            <div className="csv-column-preview">
              <p className="csv-preview-label">Detected columns</p>
              <div className="csv-preview-chips">
                {parsed.dataset.columns.map(col => (
                  <span key={col.field} className={`csv-col-chip${col.numeric ? ' csv-col-chip--num' : ''}`}>
                    {col.headerText}
                    {col.numeric && <span className="csv-col-type">#</span>}
                  </span>
                ))}
              </div>
            </div>
          )}

        </div>

        <div className="csv-modal-footer">
          <button className="ghost-btn" onClick={onClose}>Cancel</button>
          <button className="primary-btn" onClick={handleLoad} disabled={!parsed}>
            Load Dataset
          </button>
        </div>

      </div>
    </div>
  );
}
