# Native Charts

SDK4 firmware provides a globally registered `gl-line-chart` Vue 2 component.
The plugin kit does not bundle Chart.js or another renderer. It provides a thin
adapter that keeps the firmware component's observed inputs stable while adding
bounded scale and timeline behavior.

## Verified Firmware Contract

The exact `gl-line-chart-v1` contract was extracted from these official bundles:

| Model | Firmware | Admin bundle SHA-256 | Evidence |
|---|---|---|---|
| GL-MT3000 | 4.8.1 | `0409574b...116705` | Live official router bundle |
| GL-MT6000 | 4.9.1 | `7f932af0...162e3a` | Verified official firmware artifact |

Both implementations have the same props, defaults, update debounce, disabled
X/Y animations, dataset construction, and Chart.js scale behavior. The normalized
evidence is stored in
[`fixtures/gl-line-chart-contracts.json`](fixtures/gl-line-chart-contracts.json).
Firmware verification fails if a catalog entry declaring this contract drifts.

The native component copies `x`, `y`, and `plugins` into its chart configuration
when it is created. Its datasets retain references to the arrays present at that
time. Replacing those objects or arrays directly can therefore leave the canvas
with stale options or data even though Vue received new props.

## Stable Adapter

`GlStableLineChart` delegates rendering to the firmware's `gl-line-chart`. It:

- synchronizes labels and series in-place;
- preserves the axis and plugin object identities observed by the native chart;
- keeps the Y maximum from shrinking during ordinary updates;
- expands the Y maximum to a rounded `1/2/5/10` step with configurable headroom;
- remounts only the native chart when dataset structure or visual identity changes;
- optionally renders stable, chronological timeline bands over the canvas.

Declare the native dependency in `gl-plugin.json`:

```json
{
  "compatibility": {
    "minimumFirmware": "4.8.0",
    "requiredComponents": ["gl-card", "gl-line-chart", "gl-title"]
  }
}
```

Register and use the adapter in a view:

```vue
<template>
  <gl-stable-line-chart
    :labels="labels"
    :values="series"
    :dataset-labels="['Download', 'Upload']"
    :border-color="['#1785ff', '#20b26b']"
    :background-color="['transparent', 'transparent']"
    :minimum-y-max="250"
    :y-headroom="0.1"
    :height="320"
    :fill="false"
    :x="xAxis"
    :y="yAxis"
  />
</template>

<script>
const { GlStableLineChart } = require('@gl-sdk4-plugin-kit/chart');

export default {
  components: { GlStableLineChart },
  data() {
    return {
      labels: [],
      series: [[], []],
      xAxis: { display: true, ticks: { maxTicksLimit: 6 } },
      yAxis: { display: true, min: 0 },
    };
  },
};
</script>

<style src="@gl-sdk4-plugin-kit/gl-line-chart.css"></style>
```

The adapter accepts every verified native prop: `id`, `labels`, `value`, `values`,
`datasetLabels`, `backgroundColor`, `borderColor`, `borderWidth`, `height`, `fill`,
`x`, `y`, and `plugins`.

## Scale Control

`minimumYMax` is the initial lower bound. `y.max`, when supplied, is also treated
as a lower bound. The active maximum never decreases until the component is
destroyed or its `scaleKey` changes.

Change `scaleKey` when switching to a different metric or time range:

```vue
<gl-stable-line-chart
  :value="values"
  :minimum-y-max="100"
  :scale-key="selectedMetric"
/>
```

The component also exposes `resetScale()` through a template ref for an explicit
reset. A reset immediately recalculates the rounded maximum from current values.

## Timeline Bands

Timeline events use absolute milliseconds and remain independent of array order.
An explicit `id` is preferred. Without one, identity is derived from `startMs` and
`cause`, `kind`, or `label`; duration is deliberately excluded.

```vue
<gl-stable-line-chart
  :labels="labels"
  :value="latency"
  :timeline-events="outages"
  :timeline-start="windowStart"
  :timeline-end="windowEnd"
  band-label="Outages marked on chart"
/>
```

```js
outages: [{
  id: 'event-1786881106300-obstructed',
  startMs: 1786881106300,
  durationMs: 760,
  cause: 'OBSTRUCTED',
  label: 'Dish view obstructed',
  severity: 'warning',
}]
```

The default overlay insets match the verified native chart with visible axes.
Use `bandInsets` when a chart has different legend or axis dimensions:

```vue
<gl-stable-line-chart :band-insets="{ top: 8, right: 12, bottom: 42, left: 43 }" />
```

Pure helpers and their declarations are available from the same module:

```js
const {
  buildTimelineBands,
  nextStableAxisMaximum,
  syncChartArray,
  syncChartSeries,
} = require('@gl-sdk4-plugin-kit/chart');
```
