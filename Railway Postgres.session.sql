create table if not exists tasks (
    id text primary key,
    data jsonb not null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
-- List all tables in the public schema
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public';
-- Add comments to existing table
COMMENT ON TABLE tasks IS 'Stores general JSONB tasks.';
-- Add comments to columns
COMMENT ON COLUMN tasks.id IS 'Primary key, typically a UUID.';
COMMENT ON COLUMN tasks.data IS 'The main data payload, stored as JSONB.';
COMMENT ON COLUMN tasks.created_at IS 'Timestamp of creation.';
COMMENT ON COLUMN tasks.updated_at IS 'Timestamp of last update. Automatically updated via trigger.';
-- Optional: Create a trigger to auto-update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = NOW();
RETURN NEW;
END;
$$ language 'plpgsql';
-- Create trigger for tasks table if it doesn't exist
DROP TRIGGER IF EXISTS update_tasks_updated_at ON tasks;
CREATE TRIGGER update_tasks_updated_at BEFORE
UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();