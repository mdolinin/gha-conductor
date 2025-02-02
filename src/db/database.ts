import pg from '@databases/pg';
import {sql} from '@databases/pg';
import pgTyped from '@databases/pg-typed';
import DatabaseSchema from './../__generated__/index.js';
import schema from './../__generated__/schema.json' with {type: "json"};

export {sql};

const db = pg.default({
    connectionString: process.env.DATABASE_URL,
    bigIntMode: 'bigint'
});
export default db;

const {gha_hooks, gha_workflow_runs} = pgTyped.default<DatabaseSchema>({
    databaseSchema: schema,
});
export {gha_hooks, gha_workflow_runs};
