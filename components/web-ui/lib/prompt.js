'use strict';

function readPasswordFromStream(input) {
  const stream = input || process.stdin;
  return new Promise((resolve, reject) => {
    const chunks = [];
    stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => {
      const password = Buffer.concat(chunks).toString('utf8').replace(/\r?\n$/, '');
      if (!password) {
        reject(new Error('No router password was provided on stdin.'));
        return;
      }
      resolve(password);
    });
    stream.resume();
  });
}

function promptHidden(question, options) {
  const settings = options || {};
  const input = settings.input || process.stdin;
  const output = settings.output || process.stderr;

  if (!input.isTTY || typeof input.setRawMode !== 'function') {
    return Promise.reject(new Error(
      'A TTY is required for the hidden password prompt; use --password-stdin for automation.'
    ));
  }

  return new Promise((resolve, reject) => {
    const wasRaw = Boolean(input.isRaw);
    const wasFlowing = input.readableFlowing;
    const previousEncoding = input.readableEncoding;
    let password = '';
    let finished = false;

    function cleanup() {
      input.removeListener('data', onData);
      input.setRawMode(wasRaw);
      input.setEncoding(previousEncoding);
      if (wasFlowing === true) input.resume();
      else input.pause();
    }

    function finish(error) {
      if (finished) return;
      finished = true;
      cleanup();
      output.write('\n');
      if (error) reject(error);
      else resolve(password);
    }

    function onData(chunk) {
      for (const character of String(chunk)) {
        if (character === '\u0003') {
          finish(Object.assign(new Error('Password input cancelled.'), { exitCode: 130 }));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          return;
        }
        if (character === '\u007f' || character === '\b') {
          password = password.slice(0, -1);
          continue;
        }
        if (character >= ' ') password += character;
      }
    }

    input.setEncoding('utf8');
    input.setRawMode(true);
    input.on('data', onData);
    input.resume();
    output.write(question || 'Router password: ');
  });
}

async function readRouterPassword(options) {
  const settings = options || {};
  if (settings.passwordStdin) return readPasswordFromStream(settings.input);
  return promptHidden(settings.question || 'Router password: ', settings);
}

module.exports = { promptHidden, readPasswordFromStream, readRouterPassword };
