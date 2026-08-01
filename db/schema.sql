-- Cargo delivery system (China -> Tajikistan) schema
-- MySQL 8, InnoDB, utf8mb4
--
-- Soft delete: business tables use `status` (1 = active, 0 = logically
-- deleted) instead of DELETE. All foreign keys are ON DELETE RESTRICT,
-- so a row can never be hard-deleted while other rows reference it.
-- shipments already has a `status` ENUM for its lifecycle stage, so its
-- soft-delete flag is named `is_active` instead to avoid a name clash.

CREATE DATABASE IF NOT EXISTS cargo_db
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE cargo_db;

-- 1. Warehouses (склады Китая)
CREATE TABLE warehouses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  address VARCHAR(255) NULL,
  contact_person VARCHAR(150) NULL,
  phone VARCHAR(30) NULL,
  comment TEXT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_warehouses_name (name),
  INDEX idx_warehouses_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. Clients (получатели)
CREATE TABLE clients (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  full_name VARCHAR(150) NOT NULL,
  phone VARCHAR(30) NOT NULL,
  address VARCHAR(255) NULL,
  comment TEXT NULL,
  registration_date DATE NOT NULL,
  -- Долг/переплата клиента на момент начала работы в системе (не связан с cargo/payments):
  -- положительное значение — клиент должен, отрицательное — переплата/аванс.
  opening_balance_usd DECIMAL(12,2) NOT NULL DEFAULT 0,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_clients_full_name (full_name),
  INDEX idx_clients_phone (phone),
  INDEX idx_clients_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Users (учётные записи: admin, manager, client)
CREATE TABLE users (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(150) NOT NULL,
  role ENUM('admin', 'manager', 'client') NOT NULL,
  client_id INT UNSIGNED NULL,
  phone VARCHAR(30) NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  INDEX idx_users_role (role),
  INDEX idx_users_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Shipments (рейсы)
-- distributed/remaining weight & volume are NOT stored here — computed
-- from SUM(cargo.weight_kg / volume_m3) per shipment to avoid drift.
CREATE TABLE shipments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shipment_number VARCHAR(50) NOT NULL UNIQUE,
  warehouse_id INT UNSIGNED NOT NULL,
  vehicle_number VARCHAR(30) NULL,
  driver_name VARCHAR(150) NULL,
  driver_phone VARCHAR(30) NULL,
  load_date DATE NULL,
  departure_date DATE NULL,
  arrival_date DATE NULL,
  total_weight_kg DECIMAL(10,3) NOT NULL DEFAULT 0,
  total_volume_m3 DECIMAL(10,3) NOT NULL DEFAULT 0,
  status ENUM(
    'created', 'loading', 'ready_to_ship', 'in_transit',
    'arrived', 'distribution_completed', 'closed'
  ) NOT NULL DEFAULT 'created',
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  comment TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_shipments_warehouse FOREIGN KEY (warehouse_id) REFERENCES warehouses(id) ON DELETE RESTRICT,
  INDEX idx_shipments_vehicle_number (vehicle_number),
  INDEX idx_shipments_status (status),
  INDEX idx_shipments_is_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Cargo (распределение груза получателей внутри рейса)
-- calculation_type / rate / calculated_cost record how the system priced
-- the cargo at entry time; final_cost is what's actually billed and can
-- be overridden by an admin (is_cost_adjusted marks that override).
CREATE TABLE cargo (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT UNSIGNED NOT NULL,
  client_id INT UNSIGNED NOT NULL,
  added_date DATE NOT NULL,
  store VARCHAR(150) NULL,
  description TEXT NULL,
  weight_kg DECIMAL(10,3) NOT NULL,
  volume_m3 DECIMAL(10,3) NOT NULL,
  calculation_type ENUM('by_weight', 'by_volume') NOT NULL,
  rate DECIMAL(10,4) NOT NULL,
  calculated_cost DECIMAL(12,2) NOT NULL,
  final_cost DECIMAL(12,2) NOT NULL,
  is_cost_adjusted TINYINT(1) NOT NULL DEFAULT 0,
  comment TEXT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_cargo_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_cargo_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  INDEX idx_cargo_shipment (shipment_id),
  INDEX idx_cargo_client (client_id),
  INDEX idx_cargo_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6. Expense types (справочник типов расходов)
CREATE TABLE expense_types (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  status TINYINT(1) NOT NULL DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO expense_types (name) VALUES
  ('Перевозка'), ('Склад'), ('Рабочие'), ('Погрузка'),
  ('Разгрузка'), ('Документы'), ('Другое');

-- 7. Payments (оплаты)
-- exchange_rate = TJS per 1 USD; amount_usd is precomputed at insert time
-- (amount / rate for TJS, or amount as-is for USD) so history stays fixed
-- even if today's rate later changes.
CREATE TABLE payments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  client_id INT UNSIGNED NOT NULL,
  cargo_id INT UNSIGNED NULL,
  payment_date DATE NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency ENUM('USD', 'TJS') NOT NULL,
  exchange_rate DECIMAL(10,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL,
  comment TEXT NULL,
  created_by INT UNSIGNED NOT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_payments_client FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_cargo FOREIGN KEY (cargo_id) REFERENCES cargo(id) ON DELETE RESTRICT,
  CONSTRAINT fk_payments_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_payments_client (client_id),
  INDEX idx_payments_date (payment_date),
  INDEX idx_payments_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 8. Expenses (расходы по рейсу или общие расходы бизнеса)
CREATE TABLE expenses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shipment_id INT UNSIGNED NULL,
  expense_type_id INT UNSIGNED NOT NULL,
  amount DECIMAL(12,2) NOT NULL,
  currency ENUM('USD', 'TJS') NOT NULL,
  exchange_rate DECIMAL(10,4) NOT NULL DEFAULT 1,
  amount_usd DECIMAL(12,2) NOT NULL,
  comment TEXT NULL,
  created_by INT UNSIGNED NOT NULL,
  status TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_expenses_shipment FOREIGN KEY (shipment_id) REFERENCES shipments(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_type FOREIGN KEY (expense_type_id) REFERENCES expense_types(id) ON DELETE RESTRICT,
  CONSTRAINT fk_expenses_user FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  INDEX idx_expenses_shipment (shipment_id),
  INDEX idx_expenses_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9. Activity log (журнал действий) — append-only, never soft-deleted
CREATE TABLE activity_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NULL,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  entity_id INT UNSIGNED NULL,
  details JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_activity_logs_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_activity_logs_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
