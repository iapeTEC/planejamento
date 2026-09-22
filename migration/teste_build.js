const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {execFileSync}=require('node:child_process');
test('site publicado contem apenas assets publicos e hashes correspondentes',()=>{
  const root=path.resolve(__dirname,'..');
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'planejamento-build-'));
  execFileSync(process.execPath,[path.join(root,'scripts','build-site.mjs'),output],{cwd:root});
  const files=fs.readdirSync(output);
  assert.ok(!files.includes('migration'));
  assert.ok(!files.includes('docs'));
  const crypto=require('node:crypto');
  for(const name of ['app.js','admin.js','platform-config.js','styles.css']){
    const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex').slice(0,16);
    const hashed=name.replace(/\.(js|css)$/,(extension)=>'.'+hash+extension);
    assert.ok(files.includes(hashed));
    const pages=name==='admin.js'?['admin.html']:name==='app.js'?['index.html','view.html']:['index.html','view.html','admin.html'];
    for(const page of pages) assert.ok(fs.readFileSync(path.join(output,page),'utf8').includes(hashed),page+': '+name);
  }
  assert.ok(fs.existsSync(path.join(output,'assets','header.png')));
});
