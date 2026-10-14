// Tiny JSON file storage in ./data. Fine for one admin and a handful of accounts.
const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

function read(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch {
    return fallback;
  }
}

function write(name, value) {
  const file = path.join(DATA_DIR, name);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file); // atomic replace, so a crash never leaves half a file
}

module.exports = { DATA_DIR, read, write };
