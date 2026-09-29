export type ChartDatum = number | null;
export type ChartSeries = ChartDatum[];
export type ChartColor = string | string[];
export type ChartOptions = Record<string, unknown>;

export interface GlLineChartProps {
  id?: string | number;
  labels?: Array<string | number>;
  value?: ChartSeries;
  values?: ChartSeries[];
  datasetLabels?: string[];
  backgroundColor?: ChartColor;
  borderColor?: ChartColor;
  borderWidth?: number;
  height?: string | number;
  fill?: boolean;
  x?: ChartOptions;
  y?: ChartOptions;
  plugins?: ChartOptions;
}

export interface TimelineEvent {
  id?: string | number;
  startMs: number;
  durationMs?: number;
  cause?: string;
  kind?: string;
  label?: string;
  severity?: 'critical' | 'warning' | 'advisory' | 'info';
}

export interface TimelineBand {
  id: string;
  startMs: number;
  durationMs: number;
  label: string;
  severity: 'critical' | 'warning' | 'advisory' | 'info';
  left: number;
  width: number;
}

export interface TimelineBandOptions {
  minimumWidthPercent?: number;
  minimumDurationMs?: number;
}

export interface ChartBandInsets {
  top?: string | number;
  right?: string | number;
  bottom?: string | number;
  left?: string | number;
}

export interface GlStableLineChartProps extends GlLineChartProps {
  minimumYMax?: number;
  yHeadroom?: number;
  scaleKey?: string | number;
  timelineEvents?: TimelineEvent[];
  timelineStart?: number;
  timelineEnd?: number;
  minimumBandWidth?: number;
  bandInsets?: ChartBandInsets;
  bandLabel?: string;
}

export interface Vue2ComponentDefinition<Props> {
  name: string;
  props: Record<keyof Props, unknown>;
  render: (...args: unknown[]) => unknown;
}

export interface SyncChartSeriesResult {
  target: ChartSeries[];
  structureChanged: boolean;
}

export declare const GL_LINE_CHART_PROP_NAMES: readonly string[];
export declare const GlStableLineChart: Vue2ComponentDefinition<GlStableLineChartProps>;

export declare function bandIdentity(event: TimelineEvent): string;
export declare function buildTimelineBands(
  events: TimelineEvent[],
  startMs: number,
  endMs: number,
  options?: TimelineBandOptions
): TimelineBand[];
export declare function niceAxisMaximum(value: number): number;
export declare function nextStableAxisMaximum(
  values: ChartSeries | ChartSeries[],
  currentMaximum?: number,
  minimumMaximum?: number,
  headroomRatio?: number
): number;
export declare function syncChartArray<T>(target: T[], source: T[]): T[];
export declare function syncChartSeries(
  target: ChartSeries[],
  source: ChartSeries[]
): SyncChartSeriesResult;
