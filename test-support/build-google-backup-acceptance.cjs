'use strict';
// Generate a current-document-only native acceptance runner. Helper bodies
// are nested verbatim, so old staging Code.gs and production stay untouched.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const code = fs.readFileSync(path.join(__dirname,'../apps-script/Code.gs'),'utf8');
const names = ['_integrityCaptureData','_integrityVerifyGrid','_integrityWriteSnapshot','_integrityIsExpiredSnapshot','_integrityApplyRetention'];
function extract(name) {
  const start = code.indexOf('function '+name+'(');
  if (start < 0) throw Error('Missing '+name);
  let depth=0;
  for (let i=code.indexOf('{',start);i<code.length;i++) {
    if (code[i]==='{') depth++;
    if (code[i]==='}' && --depth===0) return code.slice(start,i+1);
  }
  throw Error('Unbalanced '+name);
}
const helpers = ['INTEGRITY_SNAPSHOT_RE','INTEGRITY_DATA_SNAPSHOT_RE'].map(name => code.match(new RegExp('var '+name+' = [^\\n]+;'))[0]).concat(names.map(extract)).join('\n\n');
const sha = text => crypto.createHash('sha256').update(text).digest('hex');
const template = fs.readFileSync(path.join(__dirname,'google-backup-acceptance-template.txt'),'utf8');
const output = template.replace('__CODE_HASH__',sha(code)).replace('__HELPER_HASH__',sha(helpers)).replace('__HELPERS__',helpers);
fs.writeFileSync(path.join(__dirname,'google-backup-acceptance.gs'),output);
console.log(JSON.stringify({sourceCodeSHA256:sha(code),helperSHA256:sha(helpers),bytes:Buffer.byteLength(output)}));
