require('dotenv').config();

const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const port = process.env.PORT || 8001;

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL && (process.env.DATABASE_URL.includes('localhost') || process.env.DATABASE_URL.includes('127.0.0.1'))
        ? false
        : { rejectUnauthorized: false }
});

app.use(express.json());
app.use(express.static(__dirname));

app.get('/api/tasks', async (req, res) => {
    try {
        const result = await pool.query(
            'select data from tasks order by created_at desc'
        );

        res.json(result.rows.map((row) => row.data));
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to load tasks' });
    }
});

app.post('/api/tasks', async (req, res) => {
    try {
        const task = req.body;

        if (!task.id) {
            return res.status(400).json({ error: 'Task id is required' });
        }

        await pool.query(
            `insert into tasks (id, data)
       values ($1, $2)
       on conflict (id)
       do update set data = excluded.data, updated_at = now()`,
            [task.id, task]
        );

        res.status(201).json(task);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to save task' });
    }
});

app.patch('/api/tasks/:id', async (req, res) => {
    try {
        const existing = await pool.query(
            'select data from tasks where id = $1',
            [req.params.id]
        );

        if (existing.rowCount === 0) {
            return res.status(404).json({ error: 'Task not found' });
        }

        const updatedTask = {
            ...existing.rows[0].data,
            ...req.body
        };

        await pool.query(
            'update tasks set data = $2, updated_at = now() where id = $1',
            [req.params.id, updatedTask]
        );

        res.json(updatedTask);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to update task' });
    }
});

if (require.main === module) {
    app.listen(port, () => {
        console.log(`Jara running at http://127.0.0.1:${port}`);
    });
}

module.exports = app;