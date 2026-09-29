'use strict';

const LINE_CHART_CONTRACT_ID = 'gl-line-chart-v1';

const PROP_NAMES = Object.freeze([
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

const PROP_SOURCE = [
  'props:{id:{type:[String,Number],default:""},',
  'labels:{type:Array,default:function(){return[]}},',
  'value:{type:Array,default:function(){return[]}},',
  'values:{type:Array,default:function(){return[]}},',
  'datasetLabels:{type:Array,default:function(){return[]}},',
  'backgroundColor:{type:[String,Array],default:""},',
  'borderColor:{type:[String,Array],default:""},',
  'borderWidth:{type:Number,default:2},',
  'height:{type:[String,Number],default:75},',
  'fill:{type:Boolean,default:!0},',
  'x:{type:Object,default:function(){return{display:!1}}},',
  'y:{type:Object,default:function(){return{display:!1,min:0}}},',
  'plugins:{type:Object,default:function(){return{}}}}',
].join('');

const EVIDENCE = Object.freeze([
  {
    id: 'props',
    matches(source) {
      return source.includes(PROP_SOURCE);
    },
  },
  {
    id: 'animations-disabled',
    matches(source) {
      return source.includes('animations:{y:{duration:0},x:{duration:0}}');
    },
  },
  {
    id: 'index-interaction',
    matches(source) {
      return source.includes('interaction:{intersect:!1,mode:"index"}');
    },
  },
  {
    id: 'point-and-fill-behavior',
    matches(source) {
      return source.includes('pointRadius:0,fill:this.fill?"origin":""');
    },
  },
  {
    id: 'update-debounce',
    matches(source) {
      return /setTimeout\(\(\(\)=>\{[^}]{0,400}myChart\.update\(\)[^}]{0,100}\}\),100\)/
        .test(source);
    },
  },
]);

function analyzeLineChartContract(bundleSource) {
  const source = String(bundleSource || '');
  if (!source.includes('name:"LineChart"')) {
    return {
      status: 'missing',
      contractId: null,
      propNames: [],
      missingEvidence: EVIDENCE.map((item) => item.id),
    };
  }

  const missingEvidence = EVIDENCE
    .filter((item) => !item.matches(source))
    .map((item) => item.id);
  return {
    status: missingEvidence.length ? 'incompatible' : 'verified',
    contractId: missingEvidence.length ? null : LINE_CHART_CONTRACT_ID,
    propNames: PROP_NAMES.slice(),
    missingEvidence,
    behavior: {
      updateDebounceMs: 100,
      animationsDisabled: true,
      responsive: true,
      maintainAspectRatio: false,
      pointRadius: 0,
      interactionMode: 'index',
    },
  };
}

module.exports = {
  analyzeLineChartContract,
  LINE_CHART_CONTRACT_ID,
  LINE_CHART_PROP_NAMES: PROP_NAMES,
};
