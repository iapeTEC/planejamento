import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.resolve(process.argv[2] || path.join(root, '_site'));
if(output === root) throw new Error('A saida precisa ser diferente da raiz do projeto.');
fs.mkdirSync(output, {recursive: true});
const names = new Map();
for(const name of ['app.js', 'admin.js', 'platform-config.js', 'styles.css']){
  const content = fs.readFileSync(path.join(root, name));
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
  const hashed = name.replace(/\.(js|css)$/, extension => '.' + hash + extension);
  names.set(name, hashed);
  fs.writeFileSync(path.join(output, hashed), content);
}
for(const page of ['index.html', 'view.html', 'admin.html']){
  let html = fs.readFileSync(path.join(root, page), 'utf8');
  html = html.replace(/((?:src|href)=")(app\.js|admin\.js|platform-config\.js|styles\.css)(?:\?[^"\s]*)?"/g,
    (_match, prefix, name) => prefix + names.get(name) + '"');
  fs.writeFileSync(path.join(output, page), html);
}
fs.mkdirSync(path.join(output, 'assets'), {recursive: true});
for(const name of ['header.png', 'cabecalho.png']) fs.copyFileSync(path.join(root, 'assets', name), path.join(output, 'assets', name));
fs.copyFileSync(path.join(root, 'favicon.ico'), path.join(output, 'favicon.ico'));
fs.writeFileSync(path.join(output, '.nojekyll'), '');
console.log('Site gerado em ' + output);
