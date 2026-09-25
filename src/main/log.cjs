/**
 * Write what the app says to a file, not only to a console nobody is watching.
 *
 * Every diagnosis in this project so far has come from console output with a
 * developer present. Once installed there is no console, so a recording that
 * fails at 2am leaves no trace at all. This mirrors console output to a file and
 * keeps the previous one, which is the whole feature.
 *
 * Plain CommonJS with no Electron import so it can be required before app-ready
 * and unit-checked without a build.
 *
 * **Local only.** These lines include recording file names, which are personal.
 * Nothing here is ever sent anywhere -- see the Safety section in CLAUDE.md.
 */

const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 1 << 20; // 1 MB, then roll once. Logs must not grow forever.

let stream = null;
let written = 0;
let logPath = null;
let previousPath = null;

function stamp() {
  return new Date().toISOString();
}

function format(level, args) {
  const text = args
    .map((a) => {
      if (typeof a === 'string') return a;
      if (a instanceof Error) return `${a.name}: ${a.message}\n${a.stack ?? ''}`;
      try {
        return JSON.stringify(a);
      } catch {
        return String(a);
      }
    })
    .join(' ');
  return `${stamp()} ${level} ${text}\n`;
}

function roll() {
  if (!logPath || !previousPath) return;
  try {
    stream?.end();
    fs.rmSync(previousPath, { force: true });
    fs.renameSync(logPath, previousPath);
  } catch {
    // A failed roll must not take the app down; the next open will append.
  }
  stream = fs.createWriteStream(logPath, { flags: 'a' });
  written = 0;
}

function write(level, args) {
  if (!stream) return;
  const line = format(level, args);
  written += Buffer.byteLength(line);
  stream.write(line);
  if (written >= MAX_BYTES) roll();
}

/**
 * Start logging to `dir`, and mirror console output into it.
 *
 * Wrapping console rather than replacing call sites: every existing
 * `console.error` in this app becomes a logged line, and nothing has to
 * remember to use a logger.
 *
 * @param {string} dir Writable directory (userData in the app)
 * @returns {string} the log file path
 */
function start(dir) {
  if (stream) return logPath;

  fs.mkdirSync(dir, { recursive: true });
  logPath = path.join(dir, 'app.log');
  previousPath = path.join(dir, 'app.previous.log');
  try {
    written = fs.statSync(logPath).size;
  } catch {
    written = 0;
  }
  stream = fs.createWriteStream(logPath, { flags: 'a' });
  if (written >= MAX_BYTES) roll();

  for (const [level, method] of [
    ['ERROR', 'error'],
    ['WARN', 'warn'],
    ['INFO', 'log'],
  ]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      original(...args);
      write(level, args);
    };
  }

  // The failures most worth having on disk are the ones that kill the process.
  process.on('uncaughtException', (err) => write('FATAL', ['uncaughtException', err]));
  process.on('unhandledRejection', (reason) => write('FATAL', ['unhandledRejection', reason]));

  write('INFO', [`--- log opened, pid ${process.pid} ---`]);
  return logPath;
}

/** Record something reported by a renderer window. */
function fromRenderer(level, message) {
  write(level === 'error' ? 'ERROR' : 'WARN', [`[renderer] ${message}`]);
}

function currentPath() {
  return logPath;
}

module.exports = { start, fromRenderer, currentPath, MAX_BYTES };
