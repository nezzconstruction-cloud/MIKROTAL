export const migrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        role TEXT NOT NULL CHECK (role IN ('superadmin','admin','operator','reseller')),
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        active INTEGER NOT NULL DEFAULT 1,
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE routers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL DEFAULT 8728,
        username TEXT NOT NULL,
        password_enc TEXT NOT NULL DEFAULT '',
        use_tls INTEGER NOT NULL DEFAULT 0,
        simulate INTEGER NOT NULL DEFAULT 0,
        location TEXT NOT NULL DEFAULT '',
        wan_interface TEXT NOT NULL DEFAULT '',
        hotspot_dns TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        enabled INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'unknown',
        status_message TEXT NOT NULL DEFAULT '',
        identity TEXT NOT NULL DEFAULT '',
        version TEXT NOT NULL DEFAULT '',
        board TEXT NOT NULL DEFAULT '',
        last_seen_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE profile_meta (
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        profile TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        reseller_price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        time_limit TEXT NOT NULL DEFAULT '',
        data_limit INTEGER NOT NULL DEFAULT 0,
        color TEXT NOT NULL DEFAULT '',
        PRIMARY KEY (router_id, profile)
      );

      CREATE TABLE resellers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        email TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        balance REAL NOT NULL DEFAULT 0,
        discount REAL NOT NULL DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE reseller_tx (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reseller_id INTEGER NOT NULL REFERENCES resellers(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('topup','purchase','refund','adjust')),
        amount REAL NOT NULL,
        balance_after REAL NOT NULL,
        ref TEXT NOT NULL DEFAULT '',
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_reseller_tx_reseller ON reseller_tx(reseller_id, created_at);

      CREATE TABLE voucher_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        profile TEXT NOT NULL,
        server TEXT NOT NULL DEFAULT 'all',
        qty INTEGER NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        time_limit TEXT NOT NULL DEFAULT '',
        data_limit INTEGER NOT NULL DEFAULT 0,
        mode TEXT NOT NULL DEFAULT 'same',
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        cost REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER REFERENCES voucher_batches(id) ON DELETE CASCADE,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        code TEXT NOT NULL,
        password TEXT NOT NULL,
        profile TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        time_limit TEXT NOT NULL DEFAULT '',
        data_limit INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','active','used','expired','removed','disabled')),
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        mac TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        uptime_seconds INTEGER NOT NULL DEFAULT 0,
        bytes_in INTEGER NOT NULL DEFAULT 0,
        bytes_out INTEGER NOT NULL DEFAULT 0,
        activated_at TEXT,
        expires_at TEXT,
        last_seen_at TEXT,
        router_item_id TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (router_id, code)
      );
      CREATE INDEX idx_vouchers_status ON vouchers(router_id, status);
      CREATE INDEX idx_vouchers_batch ON vouchers(batch_id);
      CREATE INDEX idx_vouchers_activated ON vouchers(activated_at);

      CREATE TABLE metrics (
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        ts INTEGER NOT NULL,
        cpu REAL,
        mem_used INTEGER,
        mem_total INTEGER,
        hdd_used INTEGER,
        hdd_total INTEGER,
        hotspot_active INTEGER,
        ppp_active INTEGER,
        rx_bps INTEGER,
        tx_bps INTEGER,
        temperature REAL,
        voltage REAL
      );
      CREATE INDEX idx_metrics_router_ts ON metrics(router_id, ts);

      CREATE TABLE alerts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER REFERENCES routers(id) ON DELETE CASCADE,
        level TEXT NOT NULL CHECK (level IN ('info','warning','critical','success')),
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL DEFAULT '',
        is_read INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_alerts_created ON alerts(created_at);

      CREATE TABLE audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT NOT NULL DEFAULT '',
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        ip TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_audit_created ON audit_logs(created_at);

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE odcs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        ports INTEGER NOT NULL DEFAULT 12,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (router_id, name)
      );

      CREATE TABLE odps (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        odc_id INTEGER REFERENCES odcs(id) ON DELETE SET NULL,
        odc_port INTEGER,
        name TEXT NOT NULL,
        location TEXT NOT NULL DEFAULT '',
        ports INTEGER NOT NULL DEFAULT 8,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (router_id, name)
      );
      CREATE UNIQUE INDEX idx_odps_odc_port ON odps(odc_id, odc_port) WHERE odc_id IS NOT NULL AND odc_port IS NOT NULL;

      CREATE TABLE ppp_packages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        profile TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        reseller_price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '30d',
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE (router_id, name)
      );

      CREATE TABLE customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        phone TEXT NOT NULL DEFAULT '',
        address TEXT NOT NULL DEFAULT '',
        username TEXT NOT NULL,
        password TEXT NOT NULL DEFAULT '',
        package_id INTEGER REFERENCES ppp_packages(id) ON DELETE SET NULL,
        profile TEXT NOT NULL DEFAULT '',
        odp_id INTEGER REFERENCES odps(id) ON DELETE SET NULL,
        odp_port INTEGER,
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','isolated','disabled')),
        expires_at TEXT,
        online INTEGER NOT NULL DEFAULT 0,
        on_router INTEGER NOT NULL DEFAULT 1,
        ip TEXT NOT NULL DEFAULT '',
        mac TEXT NOT NULL DEFAULT '',
        uptime_seconds INTEGER NOT NULL DEFAULT 0,
        last_seen_at TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        UNIQUE (router_id, username)
      );
      CREATE UNIQUE INDEX idx_customers_odp_port ON customers(odp_id, odp_port) WHERE odp_id IS NOT NULL AND odp_port IS NOT NULL;
      CREATE INDEX idx_customers_expires ON customers(router_id, status, expires_at);

      CREATE TABLE ppp_voucher_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        package_id INTEGER REFERENCES ppp_packages(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL,
        qty INTEGER NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        cost REAL NOT NULL DEFAULT 0,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE ppp_vouchers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER REFERENCES ppp_voucher_batches(id) ON DELETE CASCADE,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        code TEXT NOT NULL UNIQUE,
        package_id INTEGER REFERENCES ppp_packages(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL,
        price REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'unused' CHECK (status IN ('unused','used')),
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        customer_id INTEGER REFERENCES customers(id) ON DELETE SET NULL,
        customer_name TEXT NOT NULL DEFAULT '',
        used_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_ppp_vouchers_status ON ppp_vouchers(router_id, status);
      CREATE INDEX idx_ppp_vouchers_batch ON ppp_vouchers(batch_id);
      CREATE INDEX idx_ppp_vouchers_used ON ppp_vouchers(used_at);

      CREATE TABLE customer_tx (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
        router_id INTEGER NOT NULL REFERENCES routers(id) ON DELETE CASCADE,
        type TEXT NOT NULL CHECK (type IN ('voucher','manual','isolate','restore')),
        voucher_code TEXT NOT NULL DEFAULT '',
        reseller_id INTEGER REFERENCES resellers(id) ON DELETE SET NULL,
        package_name TEXT NOT NULL DEFAULT '',
        amount REAL NOT NULL DEFAULT 0,
        validity TEXT NOT NULL DEFAULT '',
        expires_before TEXT,
        expires_after TEXT,
        note TEXT NOT NULL DEFAULT '',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_customer_tx_customer ON customer_tx(customer_id, id);
      CREATE INDEX idx_customer_tx_created ON customer_tx(created_at);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE routers ADD COLUMN lat REAL;
      ALTER TABLE routers ADD COLUMN lng REAL;
      ALTER TABLE odcs ADD COLUMN lat REAL;
      ALTER TABLE odcs ADD COLUMN lng REAL;
      ALTER TABLE odps ADD COLUMN lat REAL;
      ALTER TABLE odps ADD COLUMN lng REAL;
      ALTER TABLE customers ADD COLUMN lat REAL;
      ALTER TABLE customers ADD COLUMN lng REAL;
    `,
  },
];
