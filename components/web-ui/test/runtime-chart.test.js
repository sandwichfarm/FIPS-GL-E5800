'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  analyzeLineChartContract,
  LINE_CHART_CONTRACT_ID,
} = require('../lib/chart-contract');
const {
  buildTimelineBands,
  GlStableLineChart,
  nextStableAxisMaximum,
  syncChartArray,
  syncChartSeries,
} = require('../runtime/chart');

const root = path.resolve(__dirname, '..');

test('recognizes the verified native gl-line-chart contract and rejects drift', function() {
  const source = [
    'name:"LineChart",props:{id:{type:[String,Number],default:""},',
    'labels:{type:Array,default:function(){return[]}},',
    'value:{type:Array,default:function(){return[]}},',
    'values:{type:Array,default:function(){return[]}},',
    'datasetLabels:{type:Array,default:function(){return[]}},',
    'backgroundColor:{type:[String,Array],default:""},',
    'borderColor:{type:[String,Array],default:""},',
    'borderWidth:{type:Number,default:2},height:{type:[String,Number],default:75},',
    'fill:{type:Boolean,default:!0},x:{type:Object,default:function(){return{display:!1}}},',
    'y:{type:Object,default:function(){return{display:!1,min:0}}},',
    'plugins:{type:Object,default:function(){return{}}}}',
    'animations:{y:{duration:0},x:{duration:0}}',
    'interaction:{intersect:!1,mode:"index"}',
    'pointRadius:0,fill:this.fill?"origin":""',
    'setTimeout((()=>{this.myChart.update()}),100)',
  ].join('');

  const verified = analyzeLineChartContract(source);
  assert.equal(verified.status, 'verified');
  assert.equal(verified.contractId, LINE_CHART_CONTRACT_ID);
  assert.deepEqual(verified.propNames, [
    'id', 'labels', 'value', 'values', 'datasetLabels', 'backgroundColor',
    'borderColor', 'borderWidth', 'height', 'fill', 'x', 'y', 'plugins',
  ]);

  const drifted = analyzeLineChartContract(source.replace('duration:0', 'duration:250'));
  assert.equal(drifted.status, 'incompatible');
  assert.deepEqual(drifted.missingEvidence, ['animations-disabled']);
});

test('keeps a rounded Y maximum stable across ordinary data refreshes', function() {
  assert.equal(nextStableAxisMaximum([12, 87], 0, 0, 0.1), 100);
  assert.equal(nextStableAxisMaximum([12, 87], 200, 100, 0.1), 200);
  assert.equal(nextStableAxisMaximum([12, 224], 200, 100, 0.1), 500);
  assert.equal(nextStableAxisMaximum([12, 40], 500, 100, 0.1), 500);
});

test('synchronizes chart data without replacing observed array identities', function() {
  const labels = ['old'];
  const returnedLabels = syncChartArray(labels, ['new', 'latest']);
  assert.equal(returnedLabels, labels);
  assert.deepEqual(labels, ['new', 'latest']);

  const series = [[1, 2], [3, 4]];
  const firstSeries = series[0];
  const result = syncChartSeries(series, [[5], [6, 7]]);
  assert.equal(result.target, series);
  assert.equal(series[0], firstSeries);
  assert.equal(result.structureChanged, false);
  assert.deepEqual(series, [[5], [6, 7]]);

  assert.equal(syncChartSeries(series, [[8]]).structureChanged, true);
});

test('builds stable chronological timeline bands independent of duration changes', function() {
  const events = [
    { startMs: 3000, durationMs: 500, cause: 'NO_PINGS', label: 'Newer' },
    { startMs: 1000, durationMs: 500, cause: 'OBSTRUCTED', label: 'Older' },
  ];
  const first = buildTimelineBands(events, 0, 5000);
  events[0].durationMs = 1500;
  const second = buildTimelineBands(events, 0, 5000);

  assert.deepEqual(first.map(function(band) { return band.label; }), ['Older', 'Newer']);
  assert.deepEqual(
    first.map(function(band) { return band.id; }),
    second.map(function(band) { return band.id; })
  );
});

test('publishes a native-compatible Vue adapter, stylesheet, types, and evidence', function() {
  const nativeProps = [
    'id', 'labels', 'value', 'values', 'datasetLabels', 'backgroundColor',
    'borderColor', 'borderWidth', 'height', 'fill', 'x', 'y', 'plugins',
  ];
  assert.equal(GlStableLineChart.name, 'GlStableLineChart');
  nativeProps.forEach(function(prop) {
    assert.ok(GlStableLineChart.props[prop], `missing native prop ${prop}`);
  });
  assert.equal(typeof GlStableLineChart.render, 'function');

  const css = fs.readFileSync(path.join(root, 'runtime', 'gl-line-chart.css'), 'utf8');
  const types = fs.readFileSync(path.join(root, 'runtime', 'chart.d.ts'), 'utf8');
  const evidence = JSON.parse(fs.readFileSync(
    path.join(root, 'docs', 'fixtures', 'gl-line-chart-contracts.json'),
    'utf8'
  ));
  assert.match(css, /\.gl-sdk4-chart__bands/);
  assert.doesNotMatch(css, /::v-deep|\/deep\/|>>>/);
  assert.match(types, /export declare const GlStableLineChart/);
  assert.deepEqual(
    evidence.contracts.map(function(contract) { return contract.firmware; }),
    ['4.8.1', '4.9.1']
  );
  assert.ok(evidence.contracts.every(function(contract) {
    return contract.contractId === LINE_CHART_CONTRACT_ID;
  }));
});
