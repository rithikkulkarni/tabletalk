'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Chart, registerables } from 'chart.js';

Chart.register(...registerables);

interface ChartPanelProps {
  chartJson: string;
  chartTitle: string;
  onTitleChange: (title: string) => void;
  onDismiss: () => void;
}

export default function ChartPanel({ chartJson, chartTitle, onTitleChange, onDismiss }: ChartPanelProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef  = useRef<Chart | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState(chartTitle);

  useEffect(() => { setTitleInput(chartTitle); }, [chartTitle]);

  useEffect(() => {
    if (!canvasRef.current || !chartJson) return;
    if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; }

    let cfg: Record<string, unknown>;
    try { cfg = JSON.parse(chartJson); } catch { return; }

    // Inject responsive options (mirrors renderSepChart() in the original JSF)
    const options: Record<string, unknown> = {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, position: 'top' },
        tooltip: { mode: 'index', intersect: false },
      },
      scales: (cfg.type === 'bar' || cfg.type === 'line') ? {
        x: { grid: { color: 'rgba(0,0,0,0.05)' }, ticks: { maxRotation: 45 } },
        y: { grid: { color: 'rgba(0,0,0,0.05)' }, beginAtZero: true,
             ticks: { callback: (v: unknown) => typeof v === 'number' && v >= 1000 ? `${(v/1000).toFixed(0)}k` : v } },
      } : undefined,
    };
    cfg.options = options;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    chartRef.current = new Chart(canvasRef.current, cfg as any);
    return () => { if (chartRef.current) { chartRef.current.destroy(); chartRef.current = null; } };
  }, [chartJson]);

  const downloadChart = () => {
    if (!canvasRef.current) return;
    const canvas = canvasRef.current;
    const out = document.createElement('canvas');
    out.width = canvas.width; out.height = canvas.height;
    const ctx = out.getContext('2d')!;
    ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, out.width, out.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = out.toDataURL('image/png');
    a.download = `${chartTitle || 'chart'}.png`;
    a.click();
  };

  const commitTitle = () => {
    setEditingTitle(false);
    onTitleChange(titleInput.trim() || chartTitle);
  };

  return (
    <div className="panel chart-panel">
      <div className="chart-panel-header">
        <div className="chart-title-wrap">
          {editingTitle ? (
            <input
              className="chart-title-input"
              value={titleInput}
              onChange={e => setTitleInput(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={e => { if (e.key === 'Enter') commitTitle(); if (e.key === 'Escape') { setEditingTitle(false); setTitleInput(chartTitle); } }}
              autoFocus
            />
          ) : (
            <span
              className="chart-panel-title"
              title="Click to edit"
              onClick={() => setEditingTitle(true)}
            >{chartTitle || 'Analysis Results'}</span>
          )}
        </div>
        <div className="chart-actions">
          <button className="chart-download-btn" onClick={downloadChart}>↓ PNG</button>
          <button className="ghost-btn chart-dismiss-btn" onClick={onDismiss}>✕ Dismiss</button>
        </div>
      </div>
      <div className="chart-canvas-wrap">
        <canvas ref={canvasRef} />
      </div>
    </div>
  );
}
