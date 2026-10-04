require('dotenv').config();
const { Pool, types } = require('pg');

// Return TIMESTAMP / DATE columns as plain strings (no JS Date / timezone shifting),
// and COUNT(*) (bigint) as numbers.
types.setTypeParser(1114, (v) => v);
types.setTypeParser(1082, (v) => v);
types.setTypeParser(20, (v) => parseInt(v, 10));
types.setTypeParser(1700, (v) => parseFloat(v));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432', 10),
  database: process.env.DB_NAME || 'eapis',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD,
  max: 10,
});

const query = (text, params) => pool.query(text, params);

module.exports = { pool, query };