-- Chess2 MySQL schema
-- Run automatically by `npm run migrate` (or apply manually in phpMyAdmin).

CREATE TABLE IF NOT EXISTS users (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  username      VARCHAR(32) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  rating        INT NOT NULL DEFAULT 1200,
  games_played  INT NOT NULL DEFAULT 0,
  wins          INT NOT NULL DEFAULT 0,
  losses        INT NOT NULL DEFAULT 0,
  draws         INT NOT NULL DEFAULT 0,
  created_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uniq_username (username)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS games (
  id            INT UNSIGNED NOT NULL AUTO_INCREMENT,
  room_code     VARCHAR(12) NOT NULL,
  white_user_id INT UNSIGNED NULL,
  black_user_id INT UNSIGNED NULL,
  white_name    VARCHAR(64) NOT NULL,
  black_name    VARCHAR(64) NOT NULL,
  time_initial  INT NOT NULL DEFAULT 0,
  time_increment INT NOT NULL DEFAULT 0,
  rated         TINYINT(1) NOT NULL DEFAULT 0,
  shape         VARCHAR(32) NOT NULL DEFAULT 'standard',
  shape_opts    VARCHAR(255) NULL,         -- JSON for custom shapes ({width,height})
  result        VARCHAR(16) NULL,          -- 1-0, 0-1, 1/2-1/2, *
  termination   VARCHAR(32) NULL,          -- checkmate, resignation, timeout, draw_agreement, stalemate, ...
  pgn           MEDIUMTEXT NULL,
  moves_json    MEDIUMTEXT NULL,           -- JSON array of {from,to,san,fen,...} for replay
  final_fen     VARCHAR(255) NULL,
  white_rating_before INT NULL,
  black_rating_before INT NULL,
  white_rating_after  INT NULL,
  black_rating_after  INT NULL,
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  finished_at   DATETIME NULL,
  white_deleted_at DATETIME NULL,          -- soft-delete: hidden from white's history
  black_deleted_at DATETIME NULL,          -- soft-delete: hidden from black's history
  PRIMARY KEY (id),
  KEY idx_room_code (room_code),
  KEY idx_white_user (white_user_id),
  KEY idx_black_user (black_user_id),
  KEY idx_finished (finished_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
