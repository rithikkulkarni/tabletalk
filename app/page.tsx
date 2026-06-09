'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
import { Database, Sun, Moon, Layers, Check } from 'lucide-react';
import type {
  DatasetInfo, ColumnDef, SortEntry, TableConfig, SavedView,
  ChatMessage, Conversation, ViewSnapshot, AnalyzeResponse,
} from '@/lib/types';
import { applyVisualChange } from '@/lib/chart-factory';

const DataGrid        = dynamic(() => import('@/components/DataGrid'),        { ssr: false });
const ChartPanel      = dynamic(() => import('@/components/ChartPanel'),      { ssr: false });
const RowDetailModal  = dynamic(() => import('@/components/RowDetailModal'),  { ssr: false });
const ConfigPanel     = dynamic(() => import('@/components/ConfigPanel'),     { ssr: false });
const ControlsPanel   = dynamic(() => import('@/components/ControlsPanel'),  { ssr: false });
const ChatSidebar     = dynamic(() => import('@/components/ChatSidebar'),     { ssr: false });

function newId(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatHeader(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/_/g,' ').replace(/\s+/g,' ').trim();
}

function buildConfigJson(dataset: string, columns: ColumnDef[], sort: SortEntry[]): string {
  return JSON.stringify({
    dataset,
    columns: columns.filter(c => c.visible).map(c => c.field),
    sort,
  }, null, 2);
}

function applyColumnOrder(cols: ColumnDef[], orderedFields: string[]): ColumnDef[] {
  if (!orderedFields.length) return cols;
  const visibleSet = new Set(orderedFields);
  const reordered: ColumnDef[] = [];
  for (const field of orderedFields) {
    const c = cols.find(c => c.field === field);
    if (c) reordered.push({ ...c, visible: true });
  }
  cols.filter(c => !visibleSet.has(c.field)).forEach(c => reordered.push({ ...c, visible: false }));
  return reordered;
}

function sortRows(rows: Record<string, unknown>[], sort: SortEntry[]): Record<string, unknown>[] {
  if (!sort.length || !rows.length) return rows;
  const availFields = new Set(Object.keys(rows[0]));
  const resolve = (field: string) => {
    if (availFields.has(field)) return field;
    const lf = field.toLowerCase();
    return Array.from(availFields).find(f => f.toLowerCase().includes(lf) || lf.includes(f.toLowerCase())) ?? field;
  };
  return [...rows].sort((a, b) => {
    for (const s of sort) {
      const f = resolve(s.field);
      const av = a[f]; const bv = b[f];
      if (av == null && bv == null) continue;
      if (av == null) return -1;
      if (bv == null) return 1;
      let cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : String(av).localeCompare(String(bv));
      if (cmp !== 0) return s.direction === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

type PanelKey = 'controls' | 'tableConfig' | 'visualConfig' | 'chat';
const PANEL_LABELS: Record<PanelKey, string> = {
  controls:     'Controls Bar',
  tableConfig:  'Table Config',
  visualConfig: 'Visual Config',
  chat:         'AI Assistant',
};
const DEFAULT_PANELS: Record<PanelKey, boolean> = {
  controls: true, tableConfig: true, visualConfig: true, chat: true,
};

export default function HomePage() {
  const [isDark, setIsDark] = useState(false);
  const [panelVis, setPanelVis] = useState<Record<PanelKey, boolean>>(DEFAULT_PANELS);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = localStorage.getItem('tt-theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const dark = saved === 'dark' || (!saved && prefersDark);
    setIsDark(dark);
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');

    const savedPanels = localStorage.getItem('tt-panels');
    if (savedPanels) {
      try { setPanelVis({ ...DEFAULT_PANELS, ...JSON.parse(savedPanels) }); } catch { /* noop */ }
    }
  }, []);

  // Close view menu on outside click
  useEffect(() => {
    if (!showViewMenu) return;
    const handler = (e: MouseEvent) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target as Node)) {
        setShowViewMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showViewMenu]);

  const toggleTheme = () => {
    const next = !isDark;
    setIsDark(next);
    document.documentElement.setAttribute('data-theme', next ? 'dark' : 'light');
    localStorage.setItem('tt-theme', next ? 'dark' : 'light');
  };

  const togglePanel = (key: PanelKey) => {
    setPanelVis(prev => {
      const next = { ...prev, [key]: !prev[key] };
      localStorage.setItem('tt-panels', JSON.stringify(next));
      return next;
    });
  };

  const [allDatasets, setAllDatasets] = useState<DatasetInfo[]>([]);
  const [selectedDataset, setSelectedDataset] = useState('payments');
  const [columns, setColumns] = useState<ColumnDef[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [sortEntries, setSortEntries] = useState<SortEntry[]>([]);
  const [analysisViewActive, setAnalysisViewActive] = useState(false);
  const [configJson, setConfigJson] = useState('{}');

  const [chartJson, setChartJson] = useState<string | null>(null);
  const [chartTitle, setChartTitle] = useState('');

  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [preAggRows, setPreAggRows] = useState<Record<string, unknown>[]>([]);
  const [groupByFields, setGroupByFields] = useState<string[]>([]);

  const snapshots = useRef<Map<string, ViewSnapshot>>(new Map());
  const [savedViews, setSavedViews] = useState<SavedView[]>([]);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConvId, setCurrentConvId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('Ready. Click column headers to sort.');

  // Refs to always have latest values inside callbacks
  const colRef   = useRef(columns);
  const rowRef   = useRef(rows);
  const sortRef  = useRef(sortEntries);
  const dsRef    = useRef(selectedDataset);
  const cfgRef   = useRef(configJson);
  const chartRef = useRef(chartJson);
  const chartTRef= useRef(chartTitle);
  const aViewRef = useRef(analysisViewActive);
  useEffect(() => { colRef.current   = columns;          }, [columns]);
  useEffect(() => { rowRef.current   = rows;             }, [rows]);
  useEffect(() => { sortRef.current  = sortEntries;      }, [sortEntries]);
  useEffect(() => { dsRef.current    = selectedDataset;  }, [selectedDataset]);
  useEffect(() => { cfgRef.current   = configJson;       }, [configJson]);
  useEffect(() => { chartRef.current = chartJson;        }, [chartJson]);
  useEffect(() => { chartTRef.current= chartTitle;       }, [chartTitle]);
  useEffect(() => { aViewRef.current = analysisViewActive;}, [analysisViewActive]);

  const loadDatasetById = useCallback((id: string, list: DatasetInfo[]) => {
    const ds = list.find(d => d.id === id) ?? list[0];
    if (!ds) return;
    const cols = ds.columns.map(c => ({ ...c, visible: true }));
    setColumns(cols);
    setRows(ds.rows);
    setSortEntries([]);
    setAnalysisViewActive(false);
    setPreAggRows([]);
    setGroupByFields([]);
    setSelectedDataset(ds.id);
    setConfigJson(buildConfigJson(ds.id, cols, []));
  }, []);

  useEffect(() => {
    fetch('/api/datasets')
      .then(r => r.json())
      .then((list: DatasetInfo[]) => {
        setAllDatasets(list);
        loadDatasetById('payments', list);
      });
    setMessages([{
      id: newId(), role: 'assistant', title: 'Analyst',
      rawContent: 'Ready to assist with data analysis and reporting.',
      htmlContent: '<p>Ready to assist with data analysis and reporting. You can ask analytical questions, request visualizations, or adjust the table view.</p><ul><li>"What is the total failed payment exposure by carrier?"</li><li>"Show monthly payment volume trends"</li><li>"Sort the table by amount, highest first"</li></ul>',
    }]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleDatasetChange = (id: string) => {
    loadDatasetById(id, allDatasets);
    setStatusMessage(`Switched to "${allDatasets.find(d => d.id === id)?.label ?? id}".`);
  };

  const handleSortChange = (sort: SortEntry[]) => {
    setSortEntries(sort);
    setRows(prev => sortRows(prev, sort));
    setConfigJson(buildConfigJson(dsRef.current, colRef.current, sort));
  };

  const handleColumnReorder = (from: number, to: number) => {
    setColumns(prev => {
      const visible = prev.filter(c => c.visible);
      if (from < 0 || to < 0 || from >= visible.length || to >= visible.length) return prev;
      const moved = visible[from];
      const newVis = [...visible]; newVis.splice(from, 1); newVis.splice(to, 0, moved);
      let vi = 0;
      const result = prev.map(c => c.visible ? newVis[vi++] : c);
      setConfigJson(buildConfigJson(dsRef.current, result, sortRef.current));
      return result;
    });
  };

  const handleToggleColumn = (field: string, visible: boolean) => {
    setColumns(prev => {
      const next = prev.map(c => c.field === field ? { ...c, visible } : c);
      setConfigJson(buildConfigJson(dsRef.current, next, sortRef.current));
      return next;
    });
  };

  const handleApplyConfig = (parsed: TableConfig) => {
    let newCols = colRef.current;
    let newRows = rowRef.current;
    let newDs   = dsRef.current;
    let newSort: SortEntry[] = sortRef.current;

    if (parsed.dataset && parsed.dataset !== newDs) {
      const ds = allDatasets.find(d => d.id === parsed.dataset);
      if (ds) {
        newCols = ds.columns.map(c => ({ ...c, visible: true }));
        newRows = ds.rows;
        newDs   = parsed.dataset;
        setSelectedDataset(newDs);
      }
    }
    if (Array.isArray(parsed.columns) && parsed.columns.length) newCols = applyColumnOrder(newCols, parsed.columns);
    if (Array.isArray(parsed.sort) && parsed.sort.length) {
      newSort = parsed.sort;
      newRows = sortRows(newRows, newSort);
    }
    setColumns(newCols); setRows(newRows); setSortEntries(newSort);
    setConfigJson(buildConfigJson(newDs, newCols, newSort));
    setStatusMessage('JSON config applied.');
  };

  const handleResetConfig = () => {
    const ds = allDatasets.find(d => d.id === dsRef.current);
    if (ds) {
      const cols = ds.columns.map(c => ({ ...c, visible: true }));
      setColumns(cols); setRows(ds.rows); setSortEntries([]);
      setConfigJson(buildConfigJson(ds.id, cols, []));
    }
    setStatusMessage('Reset to default configuration.');
  };

  const storeSnapshot = useCallback((id: string) => {
    const snap: ViewSnapshot = {
      dataset:      dsRef.current,
      configJson:   cfgRef.current,
      queryColumns: aViewRef.current ? colRef.current.filter(c => c.visible).map(c => c.field) : null,
      queryRows:    aViewRef.current ? rowRef.current : null,
      analysisView: aViewRef.current,
      chartJson:    chartRef.current,
      chartTitle:   chartTRef.current,
    };
    snapshots.current.set(id, snap);
  }, []);

  const restoreSnapshot = useCallback((snapshotId: string) => {
    const snap = snapshots.current.get(snapshotId);
    if (!snap) return;
    if (snap.analysisView && snap.queryRows?.length) {
      const newCols: ColumnDef[] = (snap.queryColumns ?? []).map(col => {
        const sample = snap.queryRows!.find(r => r[col] !== null)?.[col];
        return { field: col, headerText: formatHeader(col), numeric: typeof sample === 'number', currency: false, visible: true };
      });
      setColumns(newCols); setRows(snap.queryRows); setSortEntries([]); setAnalysisViewActive(true);
    } else {
      const ds = allDatasets.find(d => d.id === snap.dataset);
      if (ds) {
        let parsed: Partial<TableConfig> = {};
        try { parsed = JSON.parse(snap.configJson); } catch { /* noop */ }
        let cols = ds.columns.map(c => ({ ...c, visible: true }));
        let rws  = ds.rows;
        let srt: SortEntry[] = [];
        if (Array.isArray(parsed.columns) && parsed.columns.length) cols = applyColumnOrder(cols, parsed.columns);
        if (Array.isArray(parsed.sort) && parsed.sort.length) { srt = parsed.sort; rws = sortRows(rws, srt); }
        setSelectedDataset(snap.dataset); setColumns(cols); setRows(rws); setSortEntries(srt); setAnalysisViewActive(false);
      }
    }
    setChartJson(snap.chartJson); setChartTitle(snap.chartTitle ?? '');
    setConfigJson(snap.configJson); setStatusMessage('View restored from conversation.');
  }, [allDatasets]);

  const handleSendMessage = useCallback((prompt: string, response: AnalyzeResponse) => {
    const snapshotId = newId();

    if (response.gridChange) {
      const gc = response.gridChange;
      let nc = colRef.current, nr = rowRef.current, ns = sortRef.current, nd = dsRef.current;
      if (gc.dataset && gc.dataset !== nd) {
        const ds = allDatasets.find(d => d.id === gc.dataset);
        if (ds) { nc = ds.columns.map(c => ({ ...c, visible: true })); nr = ds.rows; nd = gc.dataset; setSelectedDataset(nd); }
      }
      if (Array.isArray(gc.columns) && gc.columns.length && !aViewRef.current) nc = applyColumnOrder(nc, gc.columns);
      if (Array.isArray(gc.sort)) { ns = gc.sort; nr = sortRows(nr, ns); }
      setColumns(nc); setRows(nr); setSortEntries(ns); setConfigJson(buildConfigJson(nd, nc, ns));
    }

    if (response.queryColumns?.length && response.queryRows?.length) {
      const nc: ColumnDef[] = response.queryColumns.map(col => {
        const sample = response.queryRows!.find(r => r[col] !== null)?.[col];
        return { field: col, headerText: formatHeader(col), numeric: typeof sample === 'number', currency: false, visible: true };
      });
      setColumns(nc); setRows(response.queryRows); setSortEntries([]); setAnalysisViewActive(true);
      setPreAggRows(response.preAggRows ?? []); setGroupByFields(response.groupByFields ?? []);
      setConfigJson(buildConfigJson(dsRef.current, nc, []));
    }

    if (response.visualChange && chartRef.current) {
      setChartJson(applyVisualChange(chartRef.current, response.visualChange));
    }

    if (response.chartJson !== undefined) { setChartJson(response.chartJson); setChartTitle(response.chartTitle ?? ''); }

    const userMsg: ChatMessage = { id: newId(), role: 'user', title: 'You', rawContent: prompt, htmlContent: `<p>${prompt.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')}</p>` };
    const assistantMsg: ChatMessage = { id: newId(), role: 'assistant', title: response.type === 'error' ? 'Error' : 'Analyst', rawContent: response.rawContent, htmlContent: response.htmlContent, snapshotId };

    setTimeout(() => storeSnapshot(snapshotId), 50);

    setMessages(prev => [...prev, userMsg, assistantMsg]);
    setStatusMessage('Done.');

    setConversations(prev => {
      if (currentConvId) return prev.map(c => c.id === currentConvId ? { ...c, messages: [...c.messages, userMsg, assistantMsg] } : c);
      const name = prompt.length > 52 ? prompt.slice(0, 52) + '…' : prompt;
      const nc: Conversation = { id: newId(), name, createdAt: new Date().toISOString(), messages: [userMsg, assistantMsg] };
      setCurrentConvId(nc.id);
      return [nc, ...prev];
    });
  }, [allDatasets, storeSnapshot, currentConvId]);

  const handleNewChat = () => {
    setCurrentConvId(null);
    setMessages([{ id: newId(), role: 'assistant', title: 'Analyst', rawContent: 'New conversation started.', htmlContent: '<p>Ready to assist with data analysis and reporting.</p>' }]);
    setStatusMessage('New conversation started.');
  };

  const handleConversationLoad = (id: string) => {
    const conv = conversations.find(c => c.id === id);
    if (!conv) return;
    setCurrentConvId(id); setMessages(conv.messages);
  };

  const handleSaveView = (name: string) => {
    const cfgToSave = aViewRef.current ? JSON.stringify({ dataset: dsRef.current, sort: [] }, null, 2) : cfgRef.current;
    const view: SavedView = { id: newId(), name, configJson: cfgToSave, chartJson: chartRef.current, chartTitle: chartTRef.current };
    setSavedViews(prev => [...prev.filter(v => v.name.toLowerCase() !== name.toLowerCase()), view].sort((a,b) => a.name.localeCompare(b.name)));
    setStatusMessage(`View "${name}" saved.`);
  };

  const handleLoadView = (id: string) => {
    const view = savedViews.find(v => v.id === id);
    if (!view) return;
    try {
      const parsed: TableConfig = JSON.parse(view.configJson);
      const targetId = parsed.dataset ?? dsRef.current;
      const ds = allDatasets.find(d => d.id === targetId);
      if (ds) {
        let cols = ds.columns.map(c => ({ ...c, visible: true }));
        let rws = ds.rows; let srt: SortEntry[] = [];
        if (Array.isArray(parsed.columns) && parsed.columns.length) cols = applyColumnOrder(cols, parsed.columns);
        if (Array.isArray(parsed.sort) && parsed.sort.length) { srt = parsed.sort; rws = sortRows(rws, srt); }
        setSelectedDataset(targetId); setColumns(cols); setRows(rws); setSortEntries(srt);
        setAnalysisViewActive(false); setPreAggRows([]); setGroupByFields([]);
        setConfigJson(buildConfigJson(targetId, cols, srt));
      }
    } catch { /* ignore */ }
    setChartJson(view.chartJson); setChartTitle(view.chartTitle ?? '');
    setStatusMessage(`View "${view.name}" loaded.`);
  };

  const handleDeleteView = (id: string) => {
    const view = savedViews.find(v => v.id === id);
    setSavedViews(prev => prev.filter(v => v.id !== id));
    if (view) setStatusMessage(`View "${view.name}" deleted.`);
  };

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-inner">
          <div className="app-brand">
            <div className="app-brand-icon">
              <Database size={18} strokeWidth={1.75} />
            </div>
            <div className="app-brand-text">
              <h1>TableTalk</h1>
              <span className="app-tagline">AI-powered data analysis &amp; visualization</span>
            </div>
          </div>
          <div className="app-header-actions">
            <div className="view-menu-wrap" ref={viewMenuRef}>
              <button
                className={`theme-toggle-btn${showViewMenu ? ' active' : ''}`}
                onClick={() => setShowViewMenu(v => !v)}
                title="Toggle panels"
              >
                <Layers size={15} strokeWidth={2} />
              </button>
              {showViewMenu && (
                <div className="view-menu">
                  <div className="view-menu-title">Panels</div>
                  {(Object.keys(PANEL_LABELS) as PanelKey[]).map(key => (
                    <button key={key} className="view-menu-item" onClick={() => togglePanel(key)}>
                      <span>{PANEL_LABELS[key]}</span>
                      <span className="view-menu-check">
                        {panelVis[key] && <Check size={13} strokeWidth={2.5} />}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              className="theme-toggle-btn"
              onClick={toggleTheme}
              title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {isDark ? <Sun size={15} strokeWidth={2} /> : <Moon size={15} strokeWidth={2} />}
            </button>
          </div>
        </div>
      </header>
      <div className="app-body">
        <div className="main-content">
          {panelVis.controls && (
            <ControlsPanel
              datasets={allDatasets}
              selectedDataset={selectedDataset}
              savedViews={savedViews}
              isAnalysisView={analysisViewActive}
              onDatasetChange={handleDatasetChange}
              onResetView={() => { loadDatasetById(dsRef.current, allDatasets); setStatusMessage('Reset to default view.'); }}
              onRestoreDatasetView={() => {
                const ds = allDatasets.find(d => d.id === dsRef.current);
                if (ds) { const cols = ds.columns.map(c => ({ ...c, visible: true })); setColumns(cols); setRows(ds.rows); setSortEntries([]); setAnalysisViewActive(false); setPreAggRows([]); setGroupByFields([]); setConfigJson(buildConfigJson(ds.id, cols, [])); }
                setStatusMessage('Restored dataset view.');
              }}
              onSaveView={handleSaveView}
              onLoadView={handleLoadView}
              onDeleteView={handleDeleteView}
            />
          )}

          {chartJson && (
            <ChartPanel
              chartJson={chartJson}
              chartTitle={chartTitle}
              isDark={isDark}
              onTitleChange={t => setChartTitle(t)}
              onDismiss={() => { setChartJson(null); setChartTitle(''); }}
            />
          )}

          <div className="panel grid-panel">
            <DataGrid
              columns={columns}
              rows={rows}
              sortEntries={sortEntries}
              onSortChange={handleSortChange}
              onColumnReorder={handleColumnReorder}
              onRowClick={setSelectedRow}
              isAnalysisView={analysisViewActive}
            />
            {analysisViewActive && (
              <div style={{ marginTop: 8 }}>
                <button className="ghost-btn restore-btn" onClick={() => {
                  const ds = allDatasets.find(d => d.id === dsRef.current);
                  if (ds) { const cols = ds.columns.map(c => ({ ...c, visible: true })); setColumns(cols); setRows(ds.rows); setSortEntries([]); setAnalysisViewActive(false); setPreAggRows([]); setGroupByFields([]); setConfigJson(buildConfigJson(ds.id, cols, [])); }
                  setStatusMessage('Restored dataset view.');
                }}>← Restore Dataset View</button>
              </div>
            )}
            <div className="status-area">
              <span className="status status--info">{statusMessage}</span>
            </div>
          </div>

          {(panelVis.tableConfig || panelVis.visualConfig) && (
            <ConfigPanel
              configJson={configJson}
              chartJson={chartJson}
              columns={columns}
              showTableConfig={panelVis.tableConfig}
              showVisualConfig={panelVis.visualConfig}
              onApplyConfig={handleApplyConfig}
              onApplyVisualConfig={j => setChartJson(j)}
              onResetConfig={handleResetConfig}
              onClearChart={() => { setChartJson(null); setChartTitle(''); }}
              onToggleColumn={handleToggleColumn}
            />
          )}
        </div>

        {panelVis.chat && <div className="chat-sidebar-wrap">
          <ChatSidebar
            messages={messages}
            conversations={conversations}
            currentConvId={currentConvId}
            busy={false}
            statusMessage={statusMessage}
            dataset={selectedDataset}
            configJson={configJson}
            hasExistingChart={chartJson !== null}
            isAnalysisView={analysisViewActive}
            onNewChat={handleNewChat}
            onConversationLoad={handleConversationLoad}
            onSendMessage={handleSendMessage}
            onRestoreSnapshot={restoreSnapshot}
          />
        </div>}
      </div>

      {selectedRow && (
        <RowDetailModal
          row={selectedRow}
          columns={columns}
          dsColumns={allDatasets.find(d => d.id === selectedDataset)?.columns ?? []}
          preAggRows={preAggRows}
          groupByFields={groupByFields}
          onClose={() => setSelectedRow(null)}
        />
      )}
    </div>
  );
}
