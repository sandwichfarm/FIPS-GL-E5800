#!/usr/bin/env node

'use strict';

const { FIRMWARE_CATALOG } = require('../lib/firmware-catalog');

function firmwareMatrix() {
  return {
    include: FIRMWARE_CATALOG.map((entry) => ({
      id: entry.id,
      sha256: entry.artifact.sha256,
    })),
  };
}

if (require.main === module) {
  process.stdout.write(JSON.stringify(firmwareMatrix()) + '\n');
}

module.exports = { firmwareMatrix };
