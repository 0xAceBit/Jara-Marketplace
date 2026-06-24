require('dotenv').config();
const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('proxy.rlwy.net')
    ? false
    : { rejectUnauthorized: false }
});

client.connect()
  .then(() => client.query('SELECT * FROM tasks'))
  .then(res => {
    console.log('TASKS_COUNT:', res.rows.length);
    console.log('TASKS:', JSON.stringify(res.rows, null, 2));
    return client.end();
  })
  .catch(err => {
    console.error('DB_ERROR', err);
    process.exit(1);
  });
