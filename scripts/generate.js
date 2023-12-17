const fs = require('fs');
const jsonToTS = require('json-schema-to-typescript');

async function generate() {
    fs.writeFileSync('src/gha_yaml.d.ts', await jsonToTS.compileFromFile('./schemas/gha_yaml_schema.json'))
}

generate().then(_ => console.log('done'));