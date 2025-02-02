import createConnectionPool, {sql} from '@databases/pg';
import tables from '@databases/pg-typed';
import DatabaseSchema from './../__generated__/index.js';

export {sql};

// DATABASE_URL = postgresql://my-user:my-password@localhost/my-db
const db = createConnectionPool({
    connectionString: process.env.DATABASE_URL,
    bigIntMode: 'bigint'
});
export default db;

// You can list whatever tables you actually have here:
const {gha_hooks, gha_workflow_runs} = tables<DatabaseSchema>({
    databaseSchema: require('./../__generated__/schema.json'),
});
export {gha_hooks, gha_workflow_runs};