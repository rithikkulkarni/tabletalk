'use client';

import React, { useState, useEffect, useRef } from 'react';
import { Trash2 } from 'lucide-react';
import type { DatasetInfo, SavedView } from '@/lib/types';
import CsvImportModal from '@/components/CsvImportModal';

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
  onImportDataset: (ds: DatasetInfo) => void;
  onDeleteDataset: (id: string) => void;
}

export default function ControlsPanel({
  datasets, selectedDataset, savedViews, isAnalysisView,
  onDatasetChange, onResetView, onRestoreDatasetView,
  onSaveView, onLoadView, onDeleteView, onImportDataset, onDeleteDataset,
}: ControlsPanelProps) {
  const [selectedViewId, setSelectedViewId] = useState<string>('');
  const [newViewName, setNewViewName] = useState('');
  const [showImport, setShowImport] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const armTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Disarm when dataset switches
  useEffect(() => {
    setDeleteArmed(false);
    if (armTimerRef.current) clearTimeout(armTimerRef.current);
  }, [selectedDataset]);

  // Cleanup on unmount
  useEffect(() => () => { if (armTimerRef.current) clearTimeout(armTimerRef.current); }, []);

  const existingIds = new Set(datasets.map(d => d.id));
  const currentLabel = datasets.find(d => d.id === selectedDataset)?.label ?? selectedDataset;
  const canDelete = datasets.length > 1;

  const handleDeleteClick = () => {
    if (!canDelete) return;
    if (deleteArmed) {
      if (armTimerRef.current) clearTimeout(armTimerRef.current);
      setDeleteArmed(false);
      onDeleteDataset(selectedDataset);
    } else {
      setDeleteArmed(true);
      armTimerRef.current = setTimeout(() => setDeleteArmed(false), 3000);
    }
  };

  return (
    <div className="panel controls">

      {/* ── Row 1: Dataset ─────────────────────────────────────────────────── */}
      <div className="controls-row">
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
          <button
            className="ghost-btn import-csv-btn"
            onClick={() => { setDeleteArmed(false); setShowImport(true); }}
            title="Import a CSV file as a new dataset"
          >
            Import CSV
          </button>
          <button
            className={`ghost-btn${deleteArmed ? ' delete-confirm-btn' : ' icon-btn delete-view-btn'}`}
            onClick={handleDeleteClick}
            disabled={!canDelete}
            title={!canDelete ? 'Cannot delete the only dataset' : `Delete "${currentLabel}"`}
          >
            {deleteArmed ? 'Confirm' : <Trash2 size={14} strokeWidth={2} />}
          </button>
        </div>
      </div>

      {/* ── Separator ──────────────────────────────────────────────────────── */}
      <div className="controls-hdivider" />

      {/* ── Row 2: View controls ───────────────────────────────────────────── */}
      <div className="controls-row">
        <button className="ghost-btn" onClick={onResetView}>Reset View</button>

        {isAnalysisView && (
          <button className="accent-btn restore-btn" onClick={onRestoreDatasetView}>
            ← Restore Dataset View
          </button>
        )}

        {savedViews.length > 0 && (
          <>
            <div className="controls-divider" />
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
          </>
        )}

        <div className="controls-divider" />

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

      {showImport && (
        <CsvImportModal
          existingIds={existingIds}
          onImport={ds => onImportDataset(ds)}
          onClose={() => setShowImport(false)}
        />
      )}
    </div>
  );
}
