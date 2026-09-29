'use strict';

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { readPluginProject } = require('./manifest');
const { CliError } = require('./project');

function run(command, args, options) {
  const result = spawnSync(command, args, options);
  if (result.error) {
    throw new CliError(`Cannot run ${command}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || '').trim();
    throw new CliError(
      `${command} exited with status ${result.status}${detail ? `: ${detail}` : '.'}`
    );
  }
}

function wrapBundleForEval(source) {
  return [
    '(function () {',
    '  var module = { exports: {} };',
    '  var exports = module.exports;',
    source,
    '  return (module.exports && module.exports.default) || module.exports;',
    '})()',
    '',
  ].join('\n');
}

module.exports = function build(options) {
  const cwd = options && options.cwd ? path.resolve(options.cwd) : process.cwd();
  const log = options && options.log ? options.log : console.log;
  const project = readPluginProject(cwd);
  const name = project.manifest.id;
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';

  log(`Building plugin "${name}"...`);
  const stdio = options && (options.quiet || options.json) ? 'pipe' : 'inherit';
  const env = {
    ...process.env,
    GL_SDK4_PLUGIN_KIT_RUNTIME: path.resolve(__dirname, '..', 'runtime'),
  };
  run(npx, ['webpack', '--config', 'webpack.config.js'], { stdio, cwd, env });

  const views = project.manifest.views.map((view) => {
    const jsFile = path.join(cwd, 'dist', `gl-sdk4-ui-${view.id}.common.js`);
    if (!fs.existsSync(jsFile)) {
      throw new CliError(`Expected output not found: ${jsFile}`);
    }

    const rawSource = fs.readFileSync(jsFile, 'utf8');
    fs.writeFileSync(jsFile, wrapBundleForEval(rawSource));
    run('gzip', ['-kf', jsFile], { stdio, cwd });
    const gzFile = jsFile + '.gz';
    const stats = fs.statSync(gzFile);
    log(`\nBuild complete: ${path.basename(gzFile)} (${(stats.size / 1024).toFixed(1)} KB)`);
    return { id: view.id, jsFile, gzFile };
  });
  const primary = views.find((view) => view.id === name);

  return { jsFile: primary.jsFile, gzFile: primary.gzFile, views };
};

module.exports.wrapBundleForEval = wrapBundleForEval;
