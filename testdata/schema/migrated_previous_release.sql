-- table audit_log (table audit_log)
CREATE TABLE audit_log (
    id INTEGER NOT NULL PRIMARY KEY, ts DATETIME NOT NULL, login VARCHAR NOT NULL, role VARCHAR NOT NULL,
    action VARCHAR NOT NULL, detail VARCHAR NOT NULL, ip VARCHAR NOT NULL
);

-- table organisations (table organisations)
CREATE TABLE "organisations" (
    id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, archived BOOLEAN NOT NULL);

-- table product_prices (table product_prices)
CREATE TABLE product_prices (
    id INTEGER NOT NULL PRIMARY KEY, product_id INTEGER NOT NULL, period VARCHAR NOT NULL,
    price_cents INTEGER NOT NULL, UNIQUE (product_id, period), FOREIGN KEY(product_id) REFERENCES products (id)
);

-- table products (table products)
CREATE TABLE products (
    id INTEGER NOT NULL PRIMARY KEY, name VARCHAR NOT NULL, price_cents INTEGER NOT NULL,
    active BOOLEAN NOT NULL, archived BOOLEAN NOT NULL
);

-- table report_items (table report_items)
CREATE TABLE report_items (
    id INTEGER NOT NULL PRIMARY KEY, report_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
    quantity INTEGER NOT NULL, quantity_calc INTEGER DEFAULT '0' NOT NULL, unit_price_cents INTEGER NOT NULL,
    FOREIGN KEY(report_id) REFERENCES reports (id), FOREIGN KEY(product_id) REFERENCES products (id)
);

-- table report_settings (table report_settings)
CREATE TABLE report_settings (
	organisation_id INTEGER NOT NULL, 
	calculation_enabled BOOLEAN DEFAULT '0' NOT NULL, 
	PRIMARY KEY (organisation_id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id) ON DELETE CASCADE
);

-- table reports (table reports)
CREATE TABLE reports (
    id INTEGER NOT NULL PRIMARY KEY, store_id INTEGER NOT NULL, period VARCHAR NOT NULL,
    status VARCHAR NOT NULL, UNIQUE (store_id, period), FOREIGN KEY(store_id) REFERENCES "organisations" (id)
);

-- table role_permissions (table role_permissions)
CREATE TABLE role_permissions (
	role_id INTEGER NOT NULL, 
	permission VARCHAR NOT NULL, 
	PRIMARY KEY (role_id, permission), 
	FOREIGN KEY(role_id) REFERENCES roles (id) ON DELETE CASCADE
);

-- table roles (table roles)
CREATE TABLE roles (
	id INTEGER NOT NULL, 
	"key" VARCHAR, 
	name VARCHAR NOT NULL, 
	scope VARCHAR NOT NULL, 
	organisation_id INTEGER, 
	PRIMARY KEY (id), 
	UNIQUE (name, organisation_id), 
	FOREIGN KEY(organisation_id) REFERENCES organisations (id) ON DELETE CASCADE
);

-- table schema_migrations (table schema_migrations)
CREATE TABLE schema_migrations (id VARCHAR PRIMARY KEY, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP);

-- table user_roles (table user_roles)
CREATE TABLE user_roles (
	user_id INTEGER NOT NULL, 
	role_id INTEGER NOT NULL, 
	PRIMARY KEY (user_id, role_id), 
	FOREIGN KEY(user_id) REFERENCES users (id) ON DELETE CASCADE, 
	FOREIGN KEY(role_id) REFERENCES roles (id) ON DELETE CASCADE
);

-- table users (table users)
CREATE TABLE users (
    id INTEGER NOT NULL PRIMARY KEY, login VARCHAR NOT NULL, password_hash VARCHAR NOT NULL,
    organisation_id INTEGER, full_name VARCHAR NOT NULL DEFAULT '', active BOOLEAN NOT NULL DEFAULT 1, created_at DATETIME, FOREIGN KEY(organisation_id) REFERENCES "organisations" (id)
);

-- index ix_organisations_archived (table organisations)
CREATE INDEX ix_organisations_archived ON organisations (archived);

-- index ix_organisations_name (table organisations)
CREATE UNIQUE INDEX ix_organisations_name ON organisations (name);

-- index ix_roles_key (table roles)
CREATE UNIQUE INDEX ix_roles_key ON roles ("key");

-- index ix_roles_organisation_id (table roles)
CREATE INDEX ix_roles_organisation_id ON roles (organisation_id);

-- index ix_roles_scope (table roles)
CREATE INDEX ix_roles_scope ON roles (scope);

-- index ix_users_login (table users)
CREATE UNIQUE INDEX ix_users_login ON users (login);

-- index ix_users_organisation_id (table users)
CREATE INDEX ix_users_organisation_id ON users (organisation_id);

-- migration ids
-- platform.0001_organisations_and_roles
-- reports.0001_legacy_columns
-- reports.0002_settings_table
