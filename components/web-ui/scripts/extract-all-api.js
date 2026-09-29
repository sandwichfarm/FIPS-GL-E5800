#!/usr/bin/env node

/**
 * Extracts ALL RPC method signatures from ALL GL.iNet view bundles.
 *
 * For each method found in code:
 *   1. Finds the parameter construction (what fields get passed)
 *   2. Tests it live against the router (if --live flag)
 *   3. Outputs a complete API reference JSON
 *
 * Usage:
 *   node scripts/extract-all-api.js <views-dir>
 *   node scripts/extract-all-api.js <views-dir> --live <host> [--password-stdin]
 */

const fs = require('fs');
const path = require('path');

const viewsDir = process.argv[2];
const isLive = process.argv[3] === '--live';
const liveHost = process.argv[4];
const passwordStdin = process.argv.includes('--password-stdin');

if (!viewsDir) {
  console.error('Usage: node scripts/extract-all-api.js <views-dir> [--live <host> [--password-stdin]]');
  process.exit(1);
}

function extractFromViews(dir) {
  const result = {
    methods: {},    // method -> { views, params_code, param_fields, category }
    views: {},      // view -> [methods]
    forms: {},      // view -> [{name, fields}]
  };

  const files = fs.readdirSync(dir).filter(f => f.endsWith('.js'));

  for (const fname of files) {
    const view = fname.replace('gl-sdk4-ui-', '').replace('.common.js', '');
    const content = fs.readFileSync(path.join(dir, fname), 'utf8');

    result.views[view] = [];

    // 1. Extract ALL RPC calls: "call",["sid","module","func",params]
    const callPattern = /"call",\["sid","([^"]+)","([^"]+)",(\{[^}]*\}|\w+)\]/g;
    let match;
    while ((match = callPattern.exec(content)) !== null) {
      const [, mod, func, paramsRaw] = match;
      const method = `${mod}.${func}`;

      if (!result.views[view].includes(method)) {
        result.views[view].push(method);
      }

      if (!result.methods[method]) {
        result.methods[method] = {
          views: [],
          params_raw: [],
          param_fields: null,
          category: categorize(func),
        };
      }

      if (!result.methods[method].views.includes(view)) {
        result.methods[method].views.push(view);
      }

      if (paramsRaw !== '{}' && paramsRaw !== 't' && paramsRaw !== 'e' && paramsRaw !== 'n') {
        result.methods[method].params_raw.push(paramsRaw);
      }
    }

    // 2. Extract form data objects (data(){return{...formName:{fields}}})
    const formPattern = /(\w+Form|\w+Config|\w+Data)\s*:\s*\{([^}]{10,500})\}/g;
    while ((match = formPattern.exec(content)) !== null) {
      const [, formName, fieldsStr] = match;
      const fields = {};
      const fieldPattern = /(\w+)\s*:\s*("[^"]*"|'[^']*'|!?[01]|\d+|null|\[\]|\{[^}]*\}|\[\d[^\]]*\]|""|'')/g;
      let fMatch;
      while ((fMatch = fieldPattern.exec(fieldsStr)) !== null) {
        const [, key, val] = fMatch;
        if (key.length > 1) {
          fields[key] = parseDefault(val);
        }
      }

      if (Object.keys(fields).length >= 2) {
        if (!result.forms[view]) result.forms[view] = [];
        result.forms[view].push({ name: formName, fields });
      }
    }

    // 3. Extract inline object params: {key:variable,key:"literal"}
    const inlinePattern = /"call",\["sid","([^"]+)","([^"]+)",\{([^}]{5,300})\}\]/g;
    while ((match = inlinePattern.exec(content)) !== null) {
      const [, mod, func, fieldsStr] = match;
      const method = `${mod}.${func}`;
      const fields = {};
      const fieldPattern = /(\w+)\s*:\s*(\w+|"[^"]*"|'[^']*'|!?[01]|\d+)/g;
      let fMatch;
      while ((fMatch = fieldPattern.exec(fieldsStr)) !== null) {
        const [, key, val] = fMatch;
        if (key.length > 1) {
          fields[key] = parseDefault(val);
        }
      }
      if (Object.keys(fields).length >= 1 && result.methods[method]) {
        result.methods[method].param_fields = fields;
      }
    }

    // 4. Find parameter construction before RPC calls
    // Pattern: t.field = value; ... rpc(mod, func, t)
    // or: const t = {field: value}; ... rpc(mod, func, t)
    for (const method of Object.keys(result.methods)) {
      const [mod, func] = method.split(/\.(.*)/);
      const escaped = `"${mod}","${func}"`;
      const idx = content.indexOf(escaped);
      if (idx > 0) {
        // Get 500 chars before the call
        const before = content.slice(Math.max(0, idx - 500), idx);

        // Find t.field = patterns
        const assignPattern = /(\w)\.(\w+)\s*=\s*(?:this\.)?(\w+)/g;
        let aMatch;
        const assigned = {};
        while ((aMatch = assignPattern.exec(before)) !== null) {
          const [, varName, field, source] = aMatch;
          if (field.length > 2) {
            assigned[field] = `<from ${source}>`;
          }
        }
        if (Object.keys(assigned).length >= 2 && !result.methods[method].param_fields) {
          result.methods[method].param_fields = assigned;
        }
      }
    }
  }

  return result;
}

function categorize(func) {
  if (func.startsWith('get_') || func === 'status' || func === 'list') return 'read';
  if (func.startsWith('set_')) return 'write';
  if (func.startsWith('add_')) return 'create';
  if (func.startsWith('remove_') || func.startsWith('clear_') || func.startsWith('clean_')) return 'delete';
  if (['start', 'stop', 'connect', 'disconnect', 'reboot', 'reset_firmware', 'logout', 'unbind'].includes(func)) return 'action';
  if (func.startsWith('generate_') || func.startsWith('export_') || func.startsWith('check_') || func.startsWith('scan')) return 'utility';
  if (func.startsWith('install_') || func.startsWith('uninstall_') || func.startsWith('update_') || func.startsWith('upgrade_')) return 'install';
  return 'other';
}

function parseDefault(val) {
  if (val === '!0' || val === 'true') return true;
  if (val === '!1' || val === 'false') return false;
  if (val === 'null') return null;
  if (val === '""' || val === "''") return '';
  if (val === '[]') return [];
  if (val === '0') return 0;
  if (/^\d+$/.test(val)) return parseInt(val);
  if (val.startsWith('"') || val.startsWith("'")) return val.slice(1, -1);
  if (val.startsWith('{')) return '<object>';
  if (val.startsWith('[')) return '<array>';
  return `<${val}>`;
}

async function testLive(methods, host, password) {
  const { login, call } = require('../lib/auth');
  const { sid } = await login(host, password);

  const results = {};
  const readMethods = Object.entries(methods)
    .filter(([, info]) => info.category === 'read' || info.category === 'utility');

  console.error(`Testing ${readMethods.length} read methods...`);

  for (const [method, info] of readMethods) {
    const [mod, func] = method.split(/\.(.*)/);
    try {
      const res = await call(host, sid, mod, func);
      const keys = typeof res === 'object' && res ? Object.keys(res) : [];
      results[method] = {
        status: 'ok',
        response_keys: keys,
        response_size: JSON.stringify(res).length,
      };
      console.error(`  [OK] ${method} (${keys.length} keys)`);
    } catch (e) {
      results[method] = { status: 'error', message: e.message };
    }
  }

  return results;
}

// Main
(async () => {
  console.error('Extracting from', viewsDir);
  const data = extractFromViews(viewsDir);

  // Stats
  const methodCount = Object.keys(data.methods).length;
  const viewCount = Object.keys(data.views).length;
  const readCount = Object.values(data.methods).filter(m => m.category === 'read').length;
  const writeCount = Object.values(data.methods).filter(m => m.category === 'write').length;
  const createCount = Object.values(data.methods).filter(m => m.category === 'create').length;
  const deleteCount = Object.values(data.methods).filter(m => m.category === 'delete').length;
  const actionCount = Object.values(data.methods).filter(m => m.category === 'action').length;

  console.error(`\nFound ${methodCount} methods in ${viewCount} views:`);
  console.error(`  Read: ${readCount}, Write: ${writeCount}, Create: ${createCount}, Delete: ${deleteCount}, Action: ${actionCount}`);

  if (isLive && liveHost) {
    const { readRouterPassword } = require('../lib/prompt');
    const livePass = await readRouterPassword({ passwordStdin });
    console.error(`\nLive testing against ${liveHost}...`);
    data.live_results = await testLive(data.methods, liveHost, livePass);
    const okCount = Object.values(data.live_results).filter(r => r.status === 'ok').length;
    console.error(`\nLive: ${okCount}/${Object.keys(data.live_results).length} methods working`);
  }

  // Output
  const output = {
    extracted_at: new Date().toISOString(),
    stats: { methods: methodCount, views: viewCount, read: readCount, write: writeCount, create: createCount, delete: deleteCount, action: actionCount },
    methods: data.methods,
    forms: data.forms,
    live_results: data.live_results || null,
  };

  console.log(JSON.stringify(output, null, 2));
})();
