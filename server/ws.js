/* ============ server/ws.js — 不靠任何套件的 WebSocket（RFC 6455） ============
 * 只做遊戲需要的部分：握手、文字訊框（客戶端送來的一定有遮罩）、ping/pong 與關閉。
 * 不支援擴充功能與二進位訊框。
 *
 *   const ws = require('./ws');
 *   server.on('upgrade', (req, socket, head) => {
 *     const conn = ws.accept(req, socket, head);      // 不是 WebSocket 請求時回傳 null
 *     conn.on('message', text => ...); conn.on('close', () => ...);
 *     conn.send(text); conn.close();
 *   });
 */
'use strict';
const crypto = require('crypto');
const EventEmitter = require('events');

const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const MAX_MSG = 1024 * 1024;           // 每則訊息最多 1 MB

class Conn extends EventEmitter {
  constructor(socket) {
    super();
    this.socket = socket;
    this.open = true;
    this.buf = Buffer.alloc(0);
    this.frags = [];                   // 被拆成多段的訊息片段
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.finish('socket 關閉'));
    socket.on('error', e => this.finish('socket 錯誤 ' + (e && e.code || '')));
    socket.on('end', () => this.finish('對方結束連線'));
    // 每 20 秒 ping 一次：沒有正常斷線的客戶端靠這個偵測。
    this.pingT = setInterval(() => {
      if (!this.open) return;
      if (this.waitingPong) { this.finish('20 秒沒回 pong'); return; }
      this.waitingPong = true;
      this.frame(0x9, Buffer.alloc(0));
    }, 20000);
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = !!(b[0] & 0x80), op = b[0] & 0x0f, masked = !!(b[1] & 0x80);
      let len = b[1] & 0x7f, off = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); off = 10; }
      if (len > MAX_MSG) return this.close(1009, '訊息太大');
      if (masked) off += 4;
      if (b.length < off + len) return;
      let data = b.subarray(off, off + len);
      if (masked) {
        const m = b.subarray(off - 4, off);
        const out = Buffer.allocUnsafe(len);
        for (let i = 0; i < len; i++) out[i] = data[i] ^ m[i & 3];
        data = out;
      }
      this.buf = b.subarray(off + len);
      this.onFrame(fin, op, data);
    }
  }

  onFrame(fin, op, data) {
    if (op === 0x8) { this.close(1000, '客戶端關閉'); return; }
    if (op === 0x9) { this.frame(0xa, data); return; }
    if (op === 0xa) { this.waitingPong = false; return; }
    if (op === 0x1 || op === 0x2 || op === 0x0) {
      this.frags.push(data);
      if (!fin) return;
      const whole = this.frags.length === 1 ? this.frags[0] : Buffer.concat(this.frags);
      this.frags = [];
      if (whole.length > MAX_MSG) return this.close(1009, '訊息太大');
      this.emit('message', whole.toString('utf8'));
    }
  }

  frame(op, payload) {
    if (!this.open) return;
    const len = payload.length;
    let head;
    if (len < 126) { head = Buffer.allocUnsafe(2); head[1] = len; }
    else if (len < 65536) { head = Buffer.allocUnsafe(4); head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.allocUnsafe(10); head[1] = 127; head.writeBigUInt64BE(BigInt(len), 2); }
    head[0] = 0x80 | op;
    try { this.socket.write(Buffer.concat([head, payload])); } catch (e) { this.finish('寫入失敗'); }
  }

  send(text) { this.frame(0x1, Buffer.from(String(text), 'utf8')); }

  close(code = 1000, why = '伺服器關閉') {
    if (!this.open) return;
    const p = Buffer.allocUnsafe(2); p.writeUInt16BE(code, 0);
    this.frame(0x8, p);
    this.finish(why);
  }

  finish(why = '') {
    if (!this.open) return;
    this.open = false;
    this.why = why;               // 斷線原因（server/lan.js 會寫進 log）
    clearInterval(this.pingT);
    try { this.socket.end(); } catch (e) { /* 略 */ }
    setTimeout(() => { try { this.socket.destroy(); } catch (e) { /* 略 */ } }, 500);
    this.emit('close');
  }
}

/** 請求是合法的 WebSocket 就接受連線。→ Conn | null */
function accept(req, socket, head) {
  const key = req.headers['sec-websocket-key'];
  if (!key || !/websocket/i.test(req.headers.upgrade || '')) {
    socket.write('HTTP/1.1 400 Bad Request\r\n\r\n'); socket.destroy(); return null;
  }
  const hash = crypto.createHash('sha1').update(key + GUID).digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + hash + '\r\n\r\n');
  socket.setNoDelay(true);
  const conn = new Conn(socket);
  if (head && head.length) conn.onData(head);
  return conn;
}

module.exports = { accept };
