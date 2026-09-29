'use strict';

const GL_LINE_CHART_PROP_NAMES = Object.freeze([
  'id',
  'labels',
  'value',
  'values',
  'datasetLabels',
  'backgroundColor',
  'borderColor',
  'borderWidth',
  'height',
  'fill',
  'x',
  'y',
  'plugins',
]);

function arrayDefault() {
  return [];
}

function objectDefault() {
  return {};
}

function xAxisDefault() {
  return { display: false };
}

function yAxisDefault() {
  return { display: false, min: 0 };
}

function bandInsetsDefault() {
  return { top: 8, right: 12, bottom: 42, left: 43 };
}

function finiteNumber(value, fallback) {
  if (value === null || value === '' || !Number.isFinite(Number(value))) return fallback;
  return Number(value);
}

function collectFiniteValues(value, target) {
  const result = target || [];
  if (Array.isArray(value)) {
    value.forEach(function(item) { collectFiniteValues(item, result); });
  } else {
    const numeric = finiteNumber(value, null);
    if (numeric !== null) result.push(numeric);
  }
  return result;
}

function niceAxisMaximum(value) {
  const positive = Math.max(0, finiteNumber(value, 0));
  if (!positive) return 0;
  const exponent = Math.floor(Math.log10(positive));
  const magnitude = Math.pow(10, exponent);
  const fraction = positive / magnitude;
  const rounded = fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10;
  return rounded * magnitude;
}

function nextStableAxisMaximum(values, currentMaximum, minimumMaximum, headroomRatio) {
  const minimum = Math.max(0, finiteNumber(minimumMaximum, 0));
  const current = Math.max(minimum, finiteNumber(currentMaximum, minimum));
  const headroom = Math.max(0, finiteNumber(headroomRatio, 0.1));
  const peak = collectFiniteValues(values).reduce(function(maximum, value) {
    return value > maximum ? value : maximum;
  }, 0);
  if (peak <= current) return current;
  return Math.max(current, niceAxisMaximum(peak * (1 + headroom)));
}

function syncChartArray(target, source) {
  const output = Array.isArray(target) ? target : [];
  const input = Array.isArray(source) ? source : [];
  output.splice.apply(output, [0, output.length].concat(input));
  return output;
}

function syncChartSeries(target, source) {
  const output = Array.isArray(target) ? target : [];
  const input = Array.isArray(source) ? source : [];
  let structureChanged = output.length !== input.length;

  input.forEach(function(series, index) {
    const values = Array.isArray(series) ? series : [];
    if (!Array.isArray(output[index])) {
      output[index] = values.slice();
      structureChanged = true;
    } else {
      syncChartArray(output[index], values);
    }
  });
  if (output.length > input.length) output.splice(input.length);
  return { target: output, structureChanged };
}

function syncOwnedObject(target, source, ownedKeys) {
  const output = target && typeof target === 'object' ? target : {};
  const input = source && typeof source === 'object' ? source : {};
  const previousKeys = Array.isArray(ownedKeys) ? ownedKeys : [];
  previousKeys.forEach(function(key) {
    if (!Object.prototype.hasOwnProperty.call(input, key)) delete output[key];
  });
  Object.keys(input).forEach(function(key) { output[key] = input[key]; });
  syncChartArray(previousKeys, Object.keys(input));
  return output;
}

function bandIdentity(event) {
  if (event && event.id !== undefined && event.id !== null && event.id !== '') {
    return String(event.id);
  }
  const startMs = Math.round(finiteNumber(event && event.startMs, 0));
  const kind = String(
    (event && (event.cause || event.kind || event.label)) || 'event'
  ).trim().toUpperCase();
  return `${startMs}-${kind}`;
}

function bandSeverity(value) {
  const severity = String(value || '').toLowerCase();
  return ['critical', 'warning', 'advisory', 'info'].includes(severity)
    ? severity
    : 'warning';
}

function buildTimelineBands(events, startMs, endMs, options) {
  const start = finiteNumber(startMs, 0);
  const end = finiteNumber(endMs, 0);
  const span = end - start;
  if (span <= 0) return [];
  const settings = options || {};
  const minimumWidth = Math.max(0, finiteNumber(settings.minimumWidthPercent, 0.45));
  const minimumDuration = Math.max(0, finiteNumber(settings.minimumDurationMs, 1000));
  const byId = new Map();

  (Array.isArray(events) ? events : []).forEach(function(event) {
    const eventStart = finiteNumber(event && event.startMs, null);
    if (eventStart === null) return;
    const duration = Math.max(0, finiteNumber(event && event.durationMs, 0));
    const eventEnd = eventStart + Math.max(duration, minimumDuration);
    if (eventEnd < start || eventStart > end) return;
    const id = bandIdentity(event);
    const clippedStart = Math.max(start, eventStart);
    const clippedEnd = Math.min(end, eventEnd);
    const candidate = {
      id,
      label: String((event && event.label) || (event && event.cause) || 'Event'),
      severity: bandSeverity(event && event.severity),
      left: Math.max(0, Math.min(100, (clippedStart - start) / span * 100)),
      width: Math.max(
        minimumWidth,
        Math.min(100, (clippedEnd - clippedStart) / span * 100)
      ),
      startMs: eventStart,
      durationMs: duration,
    };
    const existing = byId.get(id);
    if (!existing || candidate.durationMs > existing.durationMs) byId.set(id, candidate);
  });

  return Array.from(byId.values()).sort(function(left, right) {
    return left.left - right.left || left.id.localeCompare(right.id);
  });
}

function cssLength(value, fallback) {
  if (typeof value === 'string' && value.trim()) return value;
  const numeric = finiteNumber(value, fallback);
  return `${numeric}px`;
}

function initialAxisMaximum(y, minimumYMax) {
  return Math.max(
    0,
    finiteNumber(minimumYMax, 0),
    finiteNumber(y && y.max, 0)
  );
}

const GlStableLineChart = {
  name: 'GlStableLineChart',
  inheritAttrs: false,
  props: {
    id: { type: [String, Number], default: '' },
    labels: { type: Array, default: arrayDefault },
    value: { type: Array, default: arrayDefault },
    values: { type: Array, default: arrayDefault },
    datasetLabels: { type: Array, default: arrayDefault },
    backgroundColor: { type: [String, Array], default: '' },
    borderColor: { type: [String, Array], default: '' },
    borderWidth: { type: Number, default: 2 },
    height: { type: [String, Number], default: 75 },
    fill: { type: Boolean, default: true },
    x: { type: Object, default: xAxisDefault },
    y: { type: Object, default: yAxisDefault },
    plugins: { type: Object, default: objectDefault },
    minimumYMax: { type: Number, default: 0 },
    yHeadroom: { type: Number, default: 0.1 },
    scaleKey: { type: [String, Number], default: '' },
    timelineEvents: { type: Array, default: arrayDefault },
    timelineStart: { type: Number, default: 0 },
    timelineEnd: { type: Number, default: 0 },
    minimumBandWidth: { type: Number, default: 0.45 },
    bandInsets: { type: Object, default: bandInsetsDefault },
    bandLabel: { type: String, default: 'Events marked on chart' },
  },
  data() {
    const stableYMax = initialAxisMaximum(this.y, this.minimumYMax);
    const nativeY = { ...(this.y || {}) };
    if (stableYMax > 0) nativeY.max = stableYMax;
    return {
      nativeLabels: (this.labels || []).slice(),
      nativeValue: (this.value || []).slice(),
      nativeValues: (this.values || []).map(function(series) {
        return Array.isArray(series) ? series.slice() : [];
      }),
      nativeX: { ...(this.x || {}) },
      nativeY,
      nativePlugins: { ...(this.plugins || {}) },
      nativeXKeys: Object.keys(this.x || {}),
      nativeYKeys: Object.keys(this.y || {}),
      nativePluginKeys: Object.keys(this.plugins || {}),
      stableYMax,
      structureRevision: 0,
    };
  },
  computed: {
    chartValues() {
      return this.nativeValues.length ? this.nativeValues : this.nativeValue;
    },
    timelineBands() {
      return buildTimelineBands(
        this.timelineEvents,
        this.timelineStart,
        this.timelineEnd,
        { minimumWidthPercent: this.minimumBandWidth }
      );
    },
    bandLayerStyle() {
      const insets = this.bandInsets || {};
      return {
        top: cssLength(insets.top, 8),
        right: cssLength(insets.right, 12),
        bottom: cssLength(insets.bottom, 42),
        left: cssLength(insets.left, 43),
      };
    },
    nativeChartKey() {
      return [
        this.id,
        this.structureRevision,
        this.nativeValues.length,
        JSON.stringify(this.datasetLabels),
        JSON.stringify(this.backgroundColor),
        JSON.stringify(this.borderColor),
        this.borderWidth,
        this.fill,
      ].join('|');
    },
  },
  watch: {
    labels: {
      deep: true,
      immediate: true,
      handler(value) { syncChartArray(this.nativeLabels, value); },
    },
    value: {
      deep: true,
      immediate: true,
      handler(value) {
        syncChartArray(this.nativeValue, value);
        this.syncAxisMaximum();
      },
    },
    values: {
      deep: true,
      immediate: true,
      handler(value) {
        const result = syncChartSeries(this.nativeValues, value);
        if (result.structureChanged) this.structureRevision += 1;
        this.syncAxisMaximum();
      },
    },
    x: {
      deep: true,
      immediate: true,
      handler(value) {
        syncOwnedObject(this.nativeX, value, this.nativeXKeys);
      },
    },
    y: {
      deep: true,
      immediate: true,
      handler(value) {
        syncOwnedObject(this.nativeY, value, this.nativeYKeys);
        this.syncAxisMaximum();
      },
    },
    plugins: {
      deep: true,
      immediate: true,
      handler(value) {
        syncOwnedObject(this.nativePlugins, value, this.nativePluginKeys);
      },
    },
    minimumYMax() { this.syncAxisMaximum(); },
    yHeadroom() { this.syncAxisMaximum(); },
    scaleKey() { this.resetScale(); },
  },
  methods: {
    syncAxisMaximum() {
      const nextMaximum = nextStableAxisMaximum(
        this.chartValues,
        this.stableYMax,
        initialAxisMaximum(this.y, this.minimumYMax),
        this.yHeadroom
      );
      if (nextMaximum > this.stableYMax) this.stableYMax = nextMaximum;
      if (this.stableYMax > 0) this.nativeY.max = this.stableYMax;
    },
    resetScale() {
      this.stableYMax = initialAxisMaximum(this.y, this.minimumYMax);
      if (this.stableYMax > 0) this.nativeY.max = this.stableYMax;
      else delete this.nativeY.max;
      this.syncAxisMaximum();
    },
  },
  render(createElement) {
    const nativeChart = createElement('gl-line-chart', {
      key: this.nativeChartKey,
      ref: 'nativeChart',
      attrs: this.$attrs,
      on: this.$listeners,
      props: {
        id: this.id,
        labels: this.nativeLabels,
        value: this.nativeValue,
        values: this.nativeValues,
        datasetLabels: this.datasetLabels,
        backgroundColor: this.backgroundColor,
        borderColor: this.borderColor,
        borderWidth: this.borderWidth,
        height: this.height,
        fill: this.fill,
        x: this.nativeX,
        y: this.nativeY,
        plugins: this.nativePlugins,
      },
    });
    const children = [];
    if (this.timelineBands.length) {
      children.push(createElement('div', {
        class: 'gl-sdk4-chart__bands',
        style: this.bandLayerStyle,
        attrs: { 'aria-label': this.bandLabel },
      }, this.timelineBands.map(function(band) {
        return createElement('span', {
          key: band.id,
          class: ['gl-sdk4-chart__band', `is-${band.severity}`],
          style: { left: `${band.left}%`, width: `${band.width}%` },
          attrs: { title: band.label },
        });
      })));
    }
    children.push(nativeChart);
    return createElement('div', { class: 'gl-sdk4-chart' }, children);
  },
};

module.exports = {
  bandIdentity,
  buildTimelineBands,
  GlStableLineChart,
  GL_LINE_CHART_PROP_NAMES,
  nextStableAxisMaximum,
  niceAxisMaximum,
  syncChartArray,
  syncChartSeries,
};
