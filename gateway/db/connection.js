/**
 * AI Meeting Interpreter — Database Connection
 *
 * Owns exactly one thing: opening the SQLite file, applying pragmas and base
 * schema, and running migrations. It does not know what a meeting, a transcript
 * or a speaker is — those live in the repositories under this folder.
 *
 * Constructed with an explicit path (from config), never a hardcoded one, so
 * tests can open ':memory:' and the packaged app can relocate the file.
 */

'use strict';

const Database = require('better-sqlite3');
const { runMigrations } = require('./migrate.js');
const { log } = require('../infrastructure/logger.js');

// Base tables: fresh-DB bootstrap only. Existing databases evolve through
// migrate.js, which is forward-only — never edit a shipped migration.
const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS meetings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    start_time DATETIME DEFAULT CURRENT_TIMESTAMP,
    summary TEXT
  );

  CREATE TABLE IF NOT EXISTS transcripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    speaker TEXT,
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS action_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    assignee TEXT,
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS technical_analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    description TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS suggested_replies (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    meeting_id INTEGER REFERENCES meetings(id),
    text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS speaker_names (
    stt_label   TEXT PRIMARY KEY,
    display_name TEXT NOT NULL,
    updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS speaker_embeddings (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    stt_label    TEXT NOT NULL,
    display_name TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    created_at   DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`;

/**
 * Open a database and bring its schema up to date.
 *
 * @param {string} dbPath  absolute path, or ':memory:' for tests
 * @returns {{db: import('better-sqlite3').Database, schemaVersion: number}}
 * @throws if the file cannot be opened or a migration fails
 */
function open(dbPath) {
  const db = new Database(dbPath);

  // WAL lets the Rust read path (adapters/sqlite.rs) query while we write.
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  db.exec(BASE_SCHEMA);
  const schemaVersion = runMigrations(db);

  log('info', 'db', 'db_opened', { schemaVersion });
  return { db, schemaVersion };
}

module.exports = { open, BASE_SCHEMA };
