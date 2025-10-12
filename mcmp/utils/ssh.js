const { Client } = require('ssh2');
const fs = require('fs');
const path = require('path');

// Execute a command over SSH using a private key from config/rsa-keys
// options: { port, timeout }
function execCommand(host, user, keyName, cmd, options = {}) {
  return new Promise((resolve, reject) => {
    const keyPath = path.join(__dirname, '..', 'config', 'rsa-keys', keyName);
    if (!fs.existsSync(keyPath)) return reject(new Error('private key not found: ' + keyPath));

    const privateKey = fs.readFileSync(keyPath, 'utf8');

    const conn = new Client();
    const out = { stdout: '', stderr: '', code: null };

    conn.on('ready', () => {
      conn.exec(cmd, (err, stream) => {
        if (err) {
          conn.end();
          return reject(err);
        }
        stream.on('close', (code, signal) => {
          out.code = code;
          conn.end();
          resolve(out);
        }).on('data', (data) => {
          out.stdout += data.toString();
        }).stderr.on('data', (data) => {
          out.stderr += data.toString();
        });
      });
    }).on('error', (err) => {
      reject(err);
    }).connect({
      host,
      port: options.port || 22,
      username: user,
      privateKey,
      readyTimeout: options.timeout || 20000
    });
  });
}

module.exports = { execCommand };
