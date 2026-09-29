'use strict';

const { createApiClient, createClient } = require('./lib/api-client');
const buildPlugin = require('./lib/build');
const { checkProject } = require('./lib/check');
const { listCapabilities } = require('./lib/capabilities');
const { inspectRouter } = require('./lib/doctor');
const initProject = require('./lib/init');
const { inspectPackage } = require('./lib/inspect');
const { readPluginProject } = require('./lib/manifest');
const packagePlugin = require('./lib/package');
const { CliError, EXIT_CODES } = require('./lib/project');
const { version } = require('./package.json');

module.exports = Object.freeze({
  api: Object.freeze({ createApiClient, createClient }),
  artifacts: Object.freeze({
    build: buildPlugin,
    inspect: inspectPackage,
    package: packagePlugin,
  }),
  errors: Object.freeze({ CliError, EXIT_CODES }),
  project: Object.freeze({
    check: checkProject,
    init: initProject,
    read: readPluginProject,
  }),
  router: Object.freeze({ inspect: inspectRouter, listCapabilities }),
  version,
});
