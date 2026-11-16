import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

test('Browser entry point and imported modules pass JavaScript syntax checks',()=>{
  for(const path of ['../public/app.js','../public/dashboard.mjs','../public/response.mjs','../public/screens.mjs','../public/trends.mjs','../pfsense.mjs']){
    const result=spawnSync(process.execPath,['--check',fileURLToPath(new URL(path,import.meta.url))],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr||path);
  }
});
