import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { decodeLength, encodeLength, encodeSentence, parseReply, SentenceParser } from '../src/lib/routeros/protocol.js';
import { RouterOSClient } from '../src/lib/routeros/client.js';
import { ConnectionError, RouterOSError } from '../src/lib/routeros/types.js';
import { formatDuration, parseBytes, parseDuration } from '../src/lib/duration.js';

test('encode/decode panjang word di semua rentang', () => {
  for (const len of [0, 1, 0x7f, 0x80, 0x3fff, 0x4000, 0x1fffff, 0x200000, 0xfffffff, 0x10000000]) {
    const enc = encodeLength(len);
    const dec = decodeLength(enc, 0);
    assert.ok(dec, `decode ${len}`);
    assert.equal(dec![0], len);
    assert.equal(dec![1], enc.length);
  }
  assert.equal(encodeLength(0x7f).length, 1);
  assert.equal(encodeLength(0x80).length, 2);
  assert.equal(encodeLength(0x4000).length, 3);
  assert.equal(encodeLength(0x200000).length, 4);
  assert.equal(encodeLength(0x10000000).length, 5);
});

test('parser sentence menangani data terpotong-potong', () => {
  const a = encodeSentence(['!re', '=name=ether1', '=comment=' + 'x'.repeat(300), '.tag=1']);
  const b = encodeSentence(['!done', '.tag=1']);
  const all = Buffer.concat([a, b]);
  const parser = new SentenceParser();
  const out: string[][] = [];
  for (let i = 0; i < all.length; i += 7) out.push(...parser.push(all.subarray(i, i + 7)));
  assert.equal(out.length, 2);
  const r = parseReply(out[0]);
  assert.equal(r.type, '!re');
  assert.equal(r.tag, '1');
  assert.equal(r.attrs.name, 'ether1');
  assert.equal(r.attrs.comment.length, 300);
});

test('parseReply memisahkan atribut dengan "=" di dalam nilai dan .id', () => {
  const r = parseReply(['!re', '=.id=*1A', '=on-event=/log info a=b', '.tag=9']);
  assert.equal(r.attrs['.id'], '*1A');
  assert.equal(r.attrs['on-event'], '/log info a=b');
});

test('durasi & ukuran', () => {
  assert.equal(parseDuration('1w2d3h4m5s'), 604800 + 2 * 86400 + 3 * 3600 + 4 * 60 + 5);
  assert.equal(parseDuration('00:30:00'), 1800);
  assert.equal(parseDuration('1d 02:00:00'), 86400 + 7200);
  assert.equal(parseDuration('3h'), 10800);
  assert.equal(parseDuration(''), 0);
  assert.equal(parseDuration('none'), 0);
  assert.equal(parseDuration('5s300ms'), 5);
  assert.equal(formatDuration(93784), '1d2h3m4s');
  assert.equal(formatDuration(0), '0s');
  assert.equal(parseBytes('1G'), 1024 ** 3);
  assert.equal(parseBytes('500M'), 500 * 1024 ** 2);
  assert.equal(parseBytes('1.5GB'), Math.floor(1.5 * 1024 ** 3));
  assert.equal(parseBytes('abc'), 0);
});

/** Server RouterOS palsu untuk menguji klien di level TCP. */
function fakeRouter(opts: { password: string }) {
  const server = net.createServer((sock) => {
    const parser = new SentenceParser();
    sock.on('data', (d) => {
      for (const words of parser.push(d)) {
        const cmd = words[0];
        const attrs = parseReply(['!x', ...words.slice(1)]);
        const tag = attrs.tag;
        const send = (w: string[]) => sock.write(encodeSentence(tag ? [...w, `.tag=${tag}`] : w));
        if (cmd === '/login') {
          if (attrs.attrs.password === opts.password) send(['!done']);
          else {
            send(['!trap', '=message=invalid user name or password (6)']);
            send(['!done']);
          }
        } else if (cmd === '/system/identity/print') {
          send(['!re', '=name=FakeRouter']);
          send(['!done']);
        } else if (cmd === '/interface/print') {
          setTimeout(() => {
            send(['!re', '=.id=*1', '=name=ether1', '=running=true']);
            send(['!re', '=.id=*2', '=name=ether2', '=running=false']);
            send(['!done']);
          }, 20);
        } else if (cmd === '/ip/hotspot/user/add') {
          send(['!done', '=ret=*AB']);
        } else if (cmd === '/quit') {
          sock.end(encodeSentence(['!fatal', 'session terminated on request']));
        } else if (cmd === '/cancel') {
          /* abaikan */
        } else {
          send(['!trap', '=message=no such command prefix']);
          send(['!done']);
        }
      }
    });
  });
  return new Promise<{ port: number; close: () => void }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({ port, close: () => server.close() });
    });
  });
}

test('klien RouterOS: login, perintah paralel, ret, trap', async () => {
  const srv = await fakeRouter({ password: 'rahasia' });
  const client = new RouterOSClient({ host: '127.0.0.1', port: srv.port, username: 'admin', password: 'rahasia', tls: false, timeoutMs: 2000 });
  try {
    await client.connect();
    assert.equal(client.connected, true);
    const [ifaces, identity] = await Promise.all([client.exec('/interface/print'), client.exec('/system/identity/print')]);
    assert.equal(identity[0].name, 'FakeRouter');
    assert.equal(ifaces.length, 2);
    assert.equal(ifaces[1].running, 'false');
    const add = await client.exec('/ip/hotspot/user/add', { name: 'X', password: 'Y', disabled: false });
    assert.equal(add[0].ret, '*AB');
    await assert.rejects(client.exec('/foo/bar'), (err: unknown) => err instanceof RouterOSError && /no such command/.test(err.message));
  } finally {
    client.close();
    srv.close();
  }
});

test('klien RouterOS: password salah ditolak dengan pesan jelas', async () => {
  const srv = await fakeRouter({ password: 'benar' });
  const client = new RouterOSClient({ host: '127.0.0.1', port: srv.port, username: 'admin', password: 'salah', tls: false, timeoutMs: 2000 });
  try {
    await assert.rejects(client.connect(), (err: unknown) => err instanceof ConnectionError && /Login ditolak/.test(err.message));
  } finally {
    srv.close();
  }
});

test('klien RouterOS: port tertutup memberi pesan ramah', async () => {
  const client = new RouterOSClient({ host: '127.0.0.1', port: 1, username: 'a', password: 'b', tls: false, timeoutMs: 1000 });
  await assert.rejects(client.connect(), (err: unknown) => err instanceof ConnectionError && /ditolak|timeout|tidak/i.test(err.message));
});
