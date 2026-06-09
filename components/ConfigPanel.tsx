'use client';

import React, { useState, useEffect } from 'react';
import type { ColumnDef, TableConfig } from '@/lib/types';

interface ConfigPanelProps {
  configJson: string;
  chartJson: string | null;
  columns: ColumnDef[];
  showTableConfig: boolean;
  showVisualConfig: boolean;
  onApplyConfig: (parsed: TableConfig) => void;
  onApplyVisualConfig: (chartJson: string) => void;
  onResetConfig: () => void;
  onClearChart: () => void;
  onToggleColumn: (field: string, visible: boolean) => void;
}

export default function ConfigPanel({
  configJson, chartJson, columns, showTableConfig, showVisualConfig,
  onApplyConfig, onApplyVisualConfig, onResetConfig, onClearChart, onToggleColumn,
}: ConfigPanelProps) {
  const [tableText, setTableText] = useState(configJson);
  const [visualText, setVisualText] = useState(chartJson ?? '');
  const [tableError, setTableError] = useState('');
  const [visualError, setVisualError] = useState('');
  const [showColToggle, setShowColToggle] = useState(false);

  useEffect(() => { setTableText(configJson); }, [configJson]);
  useEffect(() => { setVisualText(chartJson ?? ''); }, [chartJson]);

  const applyTable = () => {
    setTableError('');
    try {
      const raw = JSON.parse(tableText);
      // Unwrap AI envelope
      const parsed: TableConfig = raw.type === 'table_config' && raw.config ? raw.config
                                 : raw.type === 'table_config_patch' && raw.patch ? raw.patch
                                 : raw;
      onApplyConfig(parsed);
    } catch (e) {
      setTableError(`Invalid JSON: ${(e as Error).message}`);
    }
  };

  const applyVisual = () => {
    setVisualError('');
    if (!visualText.trim()) return;
    try {
      JSON.parse(visualText); // validate
      onApplyVisualConfig(visualText);
    } catch (e) {
      setVisualError(`Invalid JSON: ${(e as Error).message}`);
    }
  };

  const exportTable = () => {
    const blob = new Blob([tableText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'table-config.json'; a.click();
    URL.revokeObjectURL(url);
  };

  const exportVisual = () => {
    if (!visualText) return;
    const blob = new Blob([visualText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'visual-config.json'; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="json-panels-row">
      {/* Table Config */}
      {showTableConfig && <div className="json-panel-half panel">
        <div className="json-header">
          <h2>Table Config</h2>
          <div className="json-actions">
            <button className="ghost-btn small-btn" onClick={() => setShowColToggle(v => !v)}>
              Columns ▾
            </button>
            <button className="ghost-btn small-btn" onClick={applyTable}>Apply</button>
            <button className="ghost-btn small-btn" onClick={exportTable}>Export</button>
            <button className="ghost-btn small-btn" onClick={onResetConfig}>Reset</button>
          </div>
        </div>
        {showColToggle && (
          <div className="col-toggle-panel">
            {columns.map(col => (
              <label key={col.field} className="col-toggle-row">
                <input
                  type="checkbox"
                  checked={col.visible}
                  onChange={e => onToggleColumn(col.field, e.target.checked)}
                />
                {col.headerText}
              </label>
            ))}
          </div>
        )}
        <textarea
          className="config-textarea"
          value={tableText}
          onChange={e => setTableText(e.target.value)}
          spellCheck={false}
        />
        {tableError && <p className="status status--error">{tableError}</p>}
      </div>}

      {/* Visual Config */}
      {showVisualConfig && (
        <div className="json-panel-half panel">
          <div className="json-header">
            <h2>Visual Config</h2>
            <div className="json-actions">
              <button className="ghost-btn small-btn" onClick={applyVisual} disabled={!chartJson}>Apply</button>
              <button className="ghost-btn small-btn" onClick={exportVisual} disabled={!chartJson}>Export</button>
              <button className="ghost-btn small-btn" onClick={onClearChart} disabled={!chartJson}>Clear</button>
            </div>
          </div>
          <textarea
            className="config-textarea visual-config-textarea"
            value={visualText}
            onChange={e => setVisualText(e.target.value)}
            placeholder="Chart.js config JSON will appear here after AI generates a chart."
            spellCheck={false}
          />
          {visualError && <p className="status status--error">{visualError}</p>}
        </div>
      )}
    </div>
  );
}
