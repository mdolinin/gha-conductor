import fs from 'fs';
import * as jsonToTS from "json-schema-to-typescript";

async function generate() {
    fs.writeFileSync('src/gha_yaml.d.ts', await jsonToTS.compileFromFile('./src/schemas/gha_yaml_schema.json'))
}

generate().then(_ => console.log('done'));