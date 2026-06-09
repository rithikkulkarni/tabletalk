// ── Column & Dataset ─────────────────────────────────────────────────────────

export interface ColumnDef {
  field: string;
  headerText: string;
  numeric: boolean;
  currency: boolean;
  visible: boolean;
  width?: number;
}

export interface DatasetInfo {
  id: string;
  label: string;
  columns: ColumnDef[];
  rows: Record<string, unknown>[];
}

// ── Sort & Config ────────────────────────────────────────────────────────────

export interface SortEntry {
  field: string;
  direction: 'asc' | 'desc';
}

export interface TableConfig {
  dataset: string;
  columns: string[];   // visible field names in display order
  sort: SortEntry[];
}

// ── Chart ────────────────────────────────────────────────────────────────────

export interface ChartResult {
  chartJson: string; // Chart.js config JSON
}

// ── Chat / Conversation ──────────────────────────────────────────────────────

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  title: string;         // "You" | "Analyst" | "Error"
  rawContent: string;
  htmlContent: string;
  snapshotId?: string;
}

export interface Conversation {
  id: string;
  name: string;
  createdAt: string;
  messages: ChatMessage[];
}

// ── Saved Views ──────────────────────────────────────────────────────────────

export interface SavedView {
  id: string;
  name: string;
  configJson: string;
  chartJson: string | null;
  chartTitle: string;
}

// ── View Snapshot ────────────────────────────────────────────────────────────

export interface ViewSnapshot {
  dataset: string;
  configJson: string;
  queryColumns: string[] | null;
  queryRows: Record<string, unknown>[] | null;
  analysisView: boolean;
  chartJson: string | null;
  chartTitle: string;
}

// ── AI Pipeline Types ────────────────────────────────────────────────────────

export interface StepCondition {
  column: string;
  op: string;
  value?: unknown;
}

export interface StepAggregation {
  column: string;
  fn: 'SUM' | 'AVG' | 'COUNT' | 'MIN' | 'MAX' | 'COUNT_DISTINCT';
  alias?: string;
}

export interface Step {
  op: string;
  label?: string;
  conditions?: StepCondition[];
  logic?: 'AND' | 'OR';
  columns?: string[];
  aggregations?: StepAggregation[];
  sort?: { column: string; direction: 'ASC' | 'DESC' };
  limit?: number;
  by?: { column: string; direction: 'ASC' | 'DESC' }[];
  n?: number;
  direction?: 'ASC' | 'DESC';
  column?: string;
  dateColumn?: string;
  granularity?: 'day' | 'week' | 'month' | 'quarter' | 'year';
  segments?: Array<{ label: string; conditions: StepCondition[]; logic?: 'AND' | 'OR' }>;
  metrics?: StepAggregation[];
  rowColumn?: string;
  colColumn?: string;
  fn?: string;
  valueColumn?: string;
}

export interface GridChange {
  dataset?: string;
  columns?: string[];
  sort?: SortEntry[];
}

export interface VisualChange {
  sort?: { by: 'value' | 'label'; direction: 'asc' | 'desc'; datasetIndex?: number };
}

export interface AiDecision {
  modes: string[];
  confidence: 'high' | 'low';
  clarificationQuestions: string[];
  needsQuery: boolean;
  scope: 'base_dataset' | 'current_view';
  chartType?: string | null;
  chartTitle?: string | null;
  steps?: Step[];
  directAnswer?: string | null;
  gridChange?: GridChange | null;
  visualChange?: VisualChange | null;
}

// ── API Request/Response bodies ──────────────────────────────────────────────

export interface AnalyzeRequest {
  prompt: string;
  dataset: string;
  configJson: string;
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  hasExistingChart: boolean;
  isAnalysisView: boolean;
}

export interface AnalyzeResponse {
  type: 'clarification' | 'gridChange' | 'visualChange' | 'analysis' | 'error';
  htmlContent: string;
  rawContent: string;
  gridChange?: GridChange | null;
  visualChange?: VisualChange | null;
  queryColumns?: string[];
  queryRows?: Record<string, unknown>[];
  chartJson?: string | null;
  chartTitle?: string | null;
  preAggRows?: Record<string, unknown>[];
  groupByFields?: string[];
  error?: string;
}
