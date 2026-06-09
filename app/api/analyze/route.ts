/**
 * Port of AiBean.processPrompt() — the full AI analysis pipeline.
 * Uses Vercel AI SDK + Anthropic Claude in place of Gemini/Ollama.
 */
import { NextResponse } from 'next/server';
import { generateText } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { getDataset } from '@/lib/datasets';
import {
  ensureTable, executeQuery, buildStepSql,
  pruneInvalidSteps, reorderStepPlan, computeSummaryFacts,
} from '@/lib/analysis';
import { createChart, applyVisualChange } from '@/lib/chart-factory';
import { UNIFIED_SYS, FINAL_ANSWER_SYS, REPAIR_SYS, buildFewShotExamples } from '@/lib/ai-prompt';
import type { AnalyzeRequest, AnalyzeResponse, AiDecision, Step, GridChange, VisualChange } from '@/lib/types';

const anthropic = createAnthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const MODEL = process.env.CLAUDE_MODEL ?? 'claude-sonnet-4-6';

// ── Helpers ───────────────────────────────────────────────────────────────────

function esc(t: string): string {
  return t.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function callModel(userPrompt: string, systemPrompt: string): Promise<string> {
  const { text } = await generateText({
    model: anthropic(MODEL),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.1,
    maxOutputTokens: 4096,
  });
  return text;
}

async function callModelJson(userPrompt: string, systemPrompt: string): Promise<AiDecision> {
  const raw = await callModel(userPrompt, systemPrompt + '\n\nReturn only valid JSON.');
  const t = raw.trim();
  const start = t.indexOf('{');
  const end   = t.lastIndexOf('}');
  if (start < 0 || end <= start) return {} as AiDecision;
  try { return JSON.parse(t.slice(start, end + 1)) as AiDecision; }
  catch { return {} as AiDecision; }
}

function formatHeader(field: string): string {
  return field.replace(/([A-Z])/g, ' $1').replace(/_/g,' ').replace(/\s+/g,' ').trim();
}

function describeSteps(steps: Step[]): string {
  const lines: string[] = [];
  const hasFilter = steps.some(s => s.op === 'filter');
  steps.forEach((s, i) => {
    switch (s.op) {
      case 'filter': {
        const conds = (s.conditions ?? []).map(c => `${c.column} ${c.op} ${JSON.stringify(c.value)}`);
        lines.push(`Step ${i+1}: FILTER — ${conds.join(' AND ')}`);
        break;
      }
      case 'groupBy': {
        const gc = (s.columns ?? []).join(', ');
        const ag = (s.aggregations ?? []).map(a => `${a.fn}(${a.column}) as ${a.alias}`).join(', ');
        lines.push(`Step ${i+1}: GROUP BY ${gc} → ${ag}`);
        break;
      }
      default:
        lines.push(`Step ${i+1}: ${s.op}`);
    }
  });
  if (!hasFilter) lines.push('NOTE: No FILTER — aggregations cover all rows.');
  return lines.join('\n');
}

// ── Main handler ──────────────────────────────────────────────────────────────

export async function POST(request: Request) {
  const body = (await request.json()) as AnalyzeRequest;
  const { prompt, dataset: datasetId, configJson, history, hasExistingChart, isAnalysisView } = body;

  const ds = await getDataset(datasetId);
  const recent = history.slice(-8);

  // Build decision prompt
  const allFields  = ds.columns.map(c => c.field).join(', ');
  const numFields  = ds.columns.filter(c => c.numeric).map(c => c.field).join(', ');
  const textFields = ds.columns.filter(c => !c.numeric).map(c => c.field).join(', ');
  const sampleJson = JSON.stringify(ds.rows.slice(0, 8));
  const histBlock  = recent.length
    ? 'Prior conversation:\n' + recent.map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`).join('\n') + '\n\n'
    : '';

  const decisionPrompt = `${histBlock}User request: ${prompt}

Dataset: ${ds.label} (${ds.rows.length} rows)
All columns: ${allFields}
Numeric: ${numFields}
Text/categorical: ${textFields}
Current config: ${configJson}
Datasets available: payments, sepDemo, adjustments, exceptions, candy

Sample rows (real values):
${sampleJson}

${buildFewShotExamples(ds.id)}
`;

  let decision: AiDecision;
  try {
    decision = await callModelJson(decisionPrompt, UNIFIED_SYS);
  } catch (e) {
    const err = `AI call failed: ${(e as Error).message}`;
    return NextResponse.json<AnalyzeResponse>({
      type: 'error',
      htmlContent: `<p class="ai-error">${esc(err)}</p>`,
      rawContent: err,
      error: err,
    });
  }

  const modes     = new Set<string>(Array.isArray(decision.modes) ? decision.modes : ['answer']);
  const hasVisual = modes.has('visual');
  const hasAnswer = modes.has('answer');
  const hasGrid   = modes.has('grid');
  const hasVisualChange = modes.has('visual_change');
  const needsQuery = !!decision.needsQuery && (hasVisual || hasAnswer);

  // ── Clarification ────────────────────────────────────────────────────────────
  const clarify = Array.isArray(decision.clarificationQuestions) ? decision.clarificationQuestions.filter(Boolean) : [];
  if (clarify.length) {
    const intro = decision.directAnswer ?? '';
    let html = '';
    if (intro) html += `<p>${esc(intro)}</p>`;
    if (clarify.length === 1) {
      html += `<p>${esc(clarify[0])}</p>`;
    } else {
      html += '<ul>' + clarify.map(q => `<li>${esc(q)}</li>`).join('') + '</ul>';
    }
    const raw = [intro, ...clarify].filter(Boolean).join(' ');
    return NextResponse.json<AnalyzeResponse>({
      type: 'clarification',
      htmlContent: html,
      rawContent: raw,
    });
  }

  // ── Grid / visual change (no SQL) ────────────────────────────────────────────
  if ((hasGrid || hasVisualChange) && !hasVisual && !hasAnswer) {
    const gridChange: GridChange | null = (hasGrid && decision.gridChange) ? decision.gridChange : null;
    let visualChange: VisualChange | null = null;
    let visualChangeApplied = false;

    if (hasVisualChange && decision.visualChange && hasExistingChart) {
      visualChange = decision.visualChange;
      visualChangeApplied = true;
    }

    const parts: string[] = [];
    if (gridChange) parts.push('Grid updated.');
    if (visualChangeApplied) parts.push('Chart updated.');
    if (!parts.length) parts.push(hasVisualChange && !hasExistingChart ? 'No chart is currently displayed to update.' : 'Could not apply the requested change.');
    const msgText = parts.join(' ');

    let html = `<p>${esc(msgText)}</p>`;
    if (gridChange)          html += '<p class="config-applied">✓ Table updated — see the grid.</p>';
    if (visualChangeApplied) html += '<p class="config-applied">✓ Chart updated — see the chart panel.</p>';

    return NextResponse.json<AnalyzeResponse>({
      type: 'gridChange',
      htmlContent: html,
      rawContent: msgText,
      gridChange,
      visualChange,
    });
  }

  // ── No SQL needed ────────────────────────────────────────────────────────────
  if ((hasVisual || hasAnswer) && !needsQuery) {
    const direct = decision.directAnswer?.trim() || (hasGrid ? 'Grid updated.' : 'Analysis complete.');
    const gridChange = hasGrid ? (decision.gridChange ?? null) : null;
    let html = `<p>${esc(direct)}</p>`;
    if (gridChange) html += '<p class="config-applied">✓ Grid also updated.</p>';
    return NextResponse.json<AnalyzeResponse>({
      type: 'analysis',
      htmlContent: html,
      rawContent: direct,
      gridChange,
    });
  }

  // ── SQL pipeline ─────────────────────────────────────────────────────────────
  if ((hasVisual || hasAnswer) && needsQuery) {
    const rawSteps = Array.isArray(decision.steps) ? decision.steps : [];
    let steps = reorderStepPlan(pruneInvalidSteps(rawSteps as Step[], ds.columns), ds.columns);

    if (!steps.length) {
      const direct = decision.directAnswer ?? 'The query could not be constructed from the available data. Try rephrasing the request.';
      return NextResponse.json<AnalyzeResponse>({
        type: 'analysis',
        htmlContent: `<p>${esc(direct)}</p>`,
        rawContent: direct,
        gridChange: hasGrid ? decision.gridChange ?? null : null,
      });
    }

    ensureTable(ds.id, ds.rows);

    let finalColumns: string[] = [];
    let finalRows: Record<string, unknown>[] = [];

    const runSteps = (stepsToRun: Step[]): void => {
      let currentSource = ds.id;
      for (let i = 0; i < stepsToRun.length; i++) {
        const step = stepsToRun[i];
        const sql  = buildStepSql(step, `"${currentSource.replace(/"/g, '""')}"`);
        const rows = executeQuery(sql);
        finalColumns = rows.length ? Object.keys(rows[0]) : [];
        finalRows    = rows;
        if (i < stepsToRun.length - 1 && rows.length) {
          const vid = `__step_${i}`;
          ensureTable(vid, rows);
          currentSource = vid;
        }
      }
    };

    try {
      runSteps(steps);
    } catch (sqlErr) {
      // Attempt AI repair
      try {
        const schema = ds.columns.map(c => `${c.field}(${c.numeric ? 'number' : 'string'})`).join(', ');
        const repairPrompt = `A SQL step pipeline failed with this error:\n  ${(sqlErr as Error).message}\n\nFailed steps:\n${JSON.stringify(steps)}\n\nDataset schema: ${schema}\n\nValid condition operators (use ONLY these):\n  eq, ne, gt, lt, gte, lte, in, not_in, contains, starts_with, ends_with, between, is_null, not_null\n\nReturn a corrected version as JSON: {"steps": [...]}\nKeep the same logic intent but fix any invalid operators or structure.`;
        const repairRaw = await callModel(repairPrompt, REPAIR_SYS);
        const t = repairRaw.trim();
        const s = t.indexOf('{'); const e = t.lastIndexOf('}');
        if (s >= 0 && e > s) {
          const fix = JSON.parse(t.slice(s, e + 1)) as { steps?: Step[] };
          if (Array.isArray(fix.steps) && fix.steps.length) {
            const repaired = pruneInvalidSteps(fix.steps, ds.columns);
            if (repaired.length) {
              steps = repaired;
              finalColumns = []; finalRows = [];
              try { runSteps(steps); } catch { /* fall through with empty results */ }
            }
          }
        }
      } catch { /* repair itself failed */ }
    }

    // Detect groupBy columns for drilldown context
    let groupByFields: string[] = [];
    let preAggRows: Record<string, unknown>[] = [];
    for (let i = steps.length - 1; i >= 0; i--) {
      const op = steps[i].op;
      if (op === 'groupBy') { groupByFields = steps[i].columns ?? []; break; }
      if (op === 'timeSeries') { groupByFields = ['period']; break; }
      if (op === 'compare')   { groupByFields = ['segment']; break; }
    }
    if (groupByFields.length) {
      try {
        if (steps.length <= 1) {
          preAggRows = ds.rows;
        } else {
          preAggRows = executeQuery(`SELECT * FROM "__step_${steps.length - 2}"`);
        }
      } catch { preAggRows = ds.rows; }
    }

    // Build chart
    const requestedChartType = decision.chartType ?? null;
    let chartJson: string | null = null;
    if ((hasVisual || finalRows.length) && finalRows.length) {
      chartJson = createChart(finalColumns, finalRows, requestedChartType);
    }

    // Apply visual change to newly created chart if both visual + visual_change modes
    if (chartJson && hasVisualChange && decision.visualChange) {
      chartJson = applyVisualChange(chartJson, decision.visualChange);
    }

    // Chart title
    let chartTitle: string | null = null;
    if (chartJson) {
      const aiTitle = decision.chartTitle?.trim() ?? null;
      if (aiTitle) {
        chartTitle = aiTitle;
      } else {
        for (let i = steps.length - 1; i >= 0; i--) {
          const s = steps[i];
          if (s.op === 'groupBy' && s.columns?.length) {
            chartTitle = 'By ' + s.columns.map(c => c.replace(/([A-Z])/g,' $1').trim()).join(' & ');
            break;
          }
          if (s.op === 'timeSeries') { chartTitle = 'Over Time'; break; }
        }
        if (!chartTitle) chartTitle = finalColumns.slice(0, 2).map(c => c.replace(/([A-Z])/g,' $1').trim()).join(' vs ');
      }
    }

    // Stage 2: answer generation
    let answer = '';
    if (hasAnswer && finalRows.length) {
      const facts = computeSummaryFacts(finalColumns, finalRows, steps);
      const scope = decision.scope ?? 'base_dataset';
      const scopeLabel = scope === 'current_view' ? 'the current visible grid view' : 'the full base dataset';
      const histBlock2 = recent.length
        ? 'Prior conversation:\n' + recent.map(m => `${m.role === 'user' ? 'User' : 'Analyst'}: ${m.content}`).join('\n') + '\n\n'
        : '';
      const answerPrompt = `${histBlock2}User question: ${prompt}
Dataset: ${ds.label}, scope: ${scopeLabel}

Query executed:
${describeSteps(steps)}

Verified facts:
${JSON.stringify(facts, null, 2)}

Result columns: ${JSON.stringify(finalColumns)}
Result rows (up to 50):
${JSON.stringify(finalRows.slice(0, 50))}`;

      try {
        const ansJson = await callModelJson(answerPrompt, FINAL_ANSWER_SYS);
        answer = (ansJson as unknown as { answer?: string }).answer ?? 'Analysis complete.';
      } catch { answer = 'Analysis complete.'; }
    } else if (!hasAnswer) {
      answer = `Here are the results${chartJson ? ' as a chart' : ''}.`;
    } else {
      answer = decision.directAnswer ?? 'The query returned no results.';
    }

    const gridChange = hasGrid ? decision.gridChange ?? null : null;
    const isAnalysis = isAnalysisView;

    let html = `<p class="analysis-answer">${esc(answer)}</p>`;
    if (finalRows.length) {
      html += `<div class="answerMeta"><span class="answerMetaChip">${finalRows.length} result rows</span></div>`;
    }
    if (finalColumns.length) {
      html += '<p class="config-applied">✎ Grid shows query results — click Restore View to go back.</p>';
    }
    if (gridChange) html += '<p class="config-applied">✓ Grid configuration also updated.</p>';

    return NextResponse.json<AnalyzeResponse>({
      type: 'analysis',
      htmlContent: html,
      rawContent: answer,
      gridChange,
      queryColumns: finalColumns.length ? finalColumns : undefined,
      queryRows:    finalRows.length    ? finalRows    : undefined,
      chartJson,
      chartTitle,
      preAggRows:    groupByFields.length ? preAggRows    : undefined,
      groupByFields: groupByFields.length ? groupByFields : undefined,
    });
  }

  // Fallback
  return NextResponse.json<AnalyzeResponse>({
    type: 'analysis',
    htmlContent: '<p>Done.</p>',
    rawContent: 'Done.',
  });
}
