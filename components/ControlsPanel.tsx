'use client';

import React, { useState } from 'react';
import type { DatasetInfo, SavedView } from '@/lib/types';

interface ControlsPanelProps {
  datasets: DatasetInfo[];
  selectedDataset: string;
  savedViews: SavedView[];
  isAnalysisView: boolean;
  onDatasetChange: (id: string) => void;
  onResetView: () => void;
  onRestoreDatasetView: () => void;
  onSaveView: (name: string) => void;
  onLoadView: (id: string) => void;
  onDeleteView: (id: string) => void;
}

export default function ControlsPanel({
  datasets, selectedDataset, savedViews, isAnalysisView,
  onDatasetChange, onResetView, onRestoreDatasetView,
  onSaveView, onLoadView, onDeleteView,
}: ControlsPanelProps) {
  const [selectedViewId, setSelectedViewId] = useState<string>('');
  const [newViewName, setNewViewName] = useState('');

  return (
    <div className="panel controls">
      {/* Dataset selector */}
      <div className="field">
        <label>Dataset:</label>
        <select
          className="select-input"
          value={selectedDataset}
          onChange={e => onDatasetChange(e.target.value)}
        >
          {datasets.map(d => (
            <option key={d.id} value={d.id}>{d.label}</option>
          ))}
        </select>
      </div>

      <button className="ghost-btn" onClick={onResetView}>Reset View</button>

      {isAnalysisView && (
        <button className="accent-btn restore-btn" onClick={onRestoreDatasetView}>
          ← Restore Dataset View
        </button>
      )}

      <div className="controls-divider" />

      {/* Saved views */}
      {savedViews.length > 0 && (
        <div className="field">
          <label>Saved Views:</label>
          <select
            className="select-input saved-view-select"
            value={selectedViewId}
            onChange={e => setSelectedViewId(e.target.value)}
          >
            <option value="">— select —</option>
            {savedViews.map(v => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
          <button
            className="ghost-btn"
            disabled={!selectedViewId}
            onClick={() => selectedViewId && onLoadView(selectedViewId)}
          >Load</button>
          <button
            className="ghost-btn delete-view-btn"
            disabled={!selectedViewId}
            onClick={() => {
              if (selectedViewId) { onDeleteView(selectedViewId); setSelectedViewId(''); }
            }}
          >Delete</button>
        </div>
      )}

      {/* Save current view */}
      <div className="field">
        <input
          className="text-input view-name-input"
          placeholder="View name…"
          value={newViewName}
          onChange={e => setNewViewName(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && newViewName.trim()) { onSaveView(newViewName.trim()); setNewViewName(''); }
          }}
        />
        <button
          className="ghost-btn"
          disabled={!newViewName.trim()}
          onClick={() => { if (newViewName.trim()) { onSaveView(newViewName.trim()); setNewViewName(''); } }}
        >Save View</button>
      </div>
    </div>
  );
}
