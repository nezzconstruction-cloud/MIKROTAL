/** Skema database platform (data langganan semua pelanggan). Data usaha tiap pelanggan ada di database terpisah. */
export const platformMigrations: { version: number; sql: string }[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE plans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        price_monthly INTEGER NOT NULL,
        max_routers INTEGER NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        active INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE tenants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        business_name TEXT NOT NULL,
        owner_name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        phone TEXT NOT NULL DEFAULT '',
        plan_id INTEGER REFERENCES plans(id),
        -- active = berjalan sesuai masa langganan; suspended = dihentikan admin; deleted = dihapus (data disimpan)
        status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','deleted')),
        trial INTEGER NOT NULL DEFAULT 1,
        period_end TEXT NOT NULL,
        suspended_reason TEXT NOT NULL DEFAULT '',
        notes TEXT NOT NULL DEFAULT '',
        reminder_stage TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE invoices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        number TEXT NOT NULL UNIQUE,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES plans(id),
        months INTEGER NOT NULL,
        base_amount INTEGER NOT NULL,
        unique_code INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        -- pending = menunggu transfer; review = bukti diunggah; paid = dikonfirmasi admin
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','review','paid','rejected','cancelled')),
        proof_file TEXT NOT NULL DEFAULT '',
        payer_name TEXT NOT NULL DEFAULT '',
        payer_note TEXT NOT NULL DEFAULT '',
        reject_reason TEXT NOT NULL DEFAULT '',
        reviewed_by TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        submitted_at TEXT,
        paid_at TEXT
      );
      CREATE INDEX idx_invoices_tenant ON invoices(tenant_id, created_at);
      CREATE INDEX idx_invoices_status ON invoices(status);

      CREATE TABLE vpn_peers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('wireguard','l2tp','sstp')),
        tunnel_ip TEXT NOT NULL UNIQUE,
        ppp_user TEXT NOT NULL DEFAULT '',
        ppp_secret_enc TEXT NOT NULL DEFAULT '',
        wg_private_enc TEXT NOT NULL DEFAULT '',
        wg_public TEXT NOT NULL DEFAULT '',
        wg_listen_port INTEGER NOT NULL DEFAULT 0,
        api_user TEXT NOT NULL,
        api_password_enc TEXT NOT NULL,
        router_id INTEGER,
        last_seen_at TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_vpn_tenant ON vpn_peers(tenant_id);

      CREATE TABLE platform_admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        last_login_at TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE platform_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE platform_audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        actor TEXT NOT NULL,
        action TEXT NOT NULL,
        target TEXT NOT NULL DEFAULT '',
        detail TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL
      );
      CREATE INDEX idx_platform_audit_time ON platform_audit(created_at);
    `,
  },
];
