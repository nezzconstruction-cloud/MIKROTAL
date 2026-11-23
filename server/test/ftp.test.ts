import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { ftpUpload } from '../src/lib/ftp.js';

/** Server FTP tiruan sederhana seperti router: USER/PASS/TYPE/PASV/STOR/QUIT. */
function fakeFtp(store: Map<string, Buffer>, password = 'rahasia') {
  return net.createServer((sock) => {
    let buf = '';
    let pending: Promise<Buffer> | null = null;
    let dataSrv: net.Server | null = null;
    const say = (s: string) => sock.write(s + '\r\n');
    say('220- MikroTik FTP server');
    say('220 siap');
    sock.on('data', async (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\r\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [cmd, ...rest] = line.split(' ');
        const arg = rest.join(' ');
        if (cmd === 'USER') say('331 password diperlukan');
        else if (cmd === 'PASS') say(arg === password ? '230 masuk' : '530 login gagal');
        else if (cmd === 'TYPE') say('200 ok');
        else if (cmd === 'PASV') {
          dataSrv = net.createServer();
          pending = new Promise((resolve) =>
            dataSrv!.once('connection', (ds) => {
              const parts: Buffer[] = [];
              ds.on('data', (x) => parts.push(x));
              ds.on('end', () => {
                resolve(Buffer.concat(parts));
                dataSrv!.close();
              });
            }),
          );
          await new Promise<void>((r) => dataSrv!.listen(0, '127.0.0.1', () => r()));
          const p = (dataSrv!.address() as net.AddressInfo).port;
          say(`227 Entering Passive Mode (10,9,8,7,${p >> 8},${p & 255})`);
        } else if (cmd === 'STOR') {
          say('150 siap terima');
          const data = await pending!;
          store.set(arg, data);
          say('226 selesai');
        } else if (cmd === 'QUIT') {
          say('221 bye');
          sock.end();
        } else say('502 tidak dikenal');
      }
    });
  });
}

test('FTP: unggah beberapa berkas (multi-baris salam, PASV dari IP lain di balik NAT)', async () => {
  const store = new Map<string, Buffer>();
  const srv = fakeFtp(store);
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', () => r()));
  const port = (srv.address() as net.AddressInfo).port;
  const big = Buffer.alloc(300_000, 7);
  await ftpUpload({ host: '127.0.0.1', port, user: 'mikrotal', password: 'rahasia' }, [
    { path: 'flash/mikrotal-portal/login.html', data: Buffer.from('<html>login</html>') },
    { path: 'flash/mikrotal-portal/mt-bg.jpg', data: big },
  ]);
  assert.equal(store.get('flash/mikrotal-portal/login.html')!.toString(), '<html>login</html>');
  assert.equal(store.get('flash/mikrotal-portal/mt-bg.jpg')!.length, big.length);
  await assert.rejects(ftpUpload({ host: '127.0.0.1', port, user: 'mikrotal', password: 'salah' }, [{ path: 'x', data: Buffer.from('x') }]), /PASS ditolak: 530/);
  srv.close();
  await assert.rejects(ftpUpload({ host: '127.0.0.1', port: 1, user: 'a', password: 'b' }, []), /menolak koneksi/);
});
