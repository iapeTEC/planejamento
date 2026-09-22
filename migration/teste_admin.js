const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
function harness(){
  const c=vm.createContext({URL,URLSearchParams,AbortController,setTimeout,clearTimeout,crypto:require('node:crypto').webcrypto,
    window:{location:{search:'',href:'https://example.org/admin.html'},LESSON_PREP_CONFIG:{gasUrl:'https://example.org/api'}},
    sessionStorage:{getItem:()=>null}, document:{}, console});
  vm.runInContext(fs.readFileSync(path.join(__dirname,'..','admin.js'),'utf8').replace(/\r\n/g,'\n').replace(/\ninitAdmin\(\);\s*$/,'\n'),c);
  c.adminToast=()=>{};
  return c;
}
test('admin espera confirmacao e propaga recusa do servidor',async()=>{
  const c=harness();
  c.fetch=async()=>({ok:true,json:async()=>({ok:false,error:'Sem permissao'})});
  await assert.rejects(c.apiPost('updateTeacher',{name:'Teste'}),/Sem permissao/);
});
test('admin aceita apenas resposta JSON com ok true',async()=>{
  const c=harness();
  c.fetch=async()=>({ok:true,json:async()=>({ok:true,payload:{revision:'r1'}})});
  assert.equal((await c.apiPost('save',{})).revision,'r1');
});
test('link de professora leva credencial no fragmento e nao na query',()=>{
  const c=harness();
  const url=new URL(c.buildTeacherLink({teacherId:'prof-test',accessToken:'secret'}));
  assert.equal(new URLSearchParams(url.hash.slice(1)).get('access'),'secret');
  assert.equal(url.searchParams.get('accessToken'),null);
});
