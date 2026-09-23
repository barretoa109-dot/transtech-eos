// Offline review probes: execute the actual component/route with synthetic data.
// No browser, credentials, network, or database writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const ts = require('../../../node_modules/typescript');
const root = process.argv[2] || path.resolve(process.cwd(), '../transtech-eos-business-os');
const evidence = [];
function moduleFrom(relative, imports, globals = {}) {
  const source = fs.readFileSync(path.join(root, relative), 'utf8');
  const output = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  }}).outputText;
  const exports = {};
  vm.runInNewContext(output, { exports, require(name) {
    if (!(name in imports)) throw new Error('Unexpected dependency: ' + name);
    return imports[name];
  }, console: { error() {} }, Response, ...globals }, { filename: relative });
  evidence.push({ file: relative, sha256: crypto.createHash('sha256').update(source).digest('hex') });
  return exports;
}
const flush = async () => { for (let i=0;i<20;i++) await Promise.resolve(); };
const textOf = n => n == null || typeof n === 'boolean' ? '' :
  typeof n !== 'object' ? String(n) : Array.isArray(n) ? n.map(textOf).join(' ') : textOf(n.props?.children);
function find(n, pred) {
  if (!n || typeof n !== 'object') return null;
  if (!Array.isArray(n) && pred(n)) return n;
  for (const child of Array.isArray(n) ? n : [n.props?.children]) {
    const result = find(child, pred); if (result) return result;
  }
  return null;
}
async function uiProbe(failRead = false) {
  const state = []; let index = 0; const effects = []; const puts = [];
  const rows = [
    { nombre:'Guaranies', tipo:'banco', moneda:'PYG', saldo_declarado:1000000, saldo_declarado_el:'2026-08-01' },
    { nombre:'Dolares', tipo:'banco', moneda:'USD', saldo_declarado:100, saldo_declarado_el:'2026-08-02' },
  ];
  const react = {
    useState(initial) { const i=index++; if (!(i in state)) state[i]=initial;
      return [state[i], value => { state[i]=typeof value==='function' ? value(state[i]) : value; }]; },
    useCallback(fn) { index++; return fn; },
    useEffect(fn) { const i=index++; if (!(i in state)) {state[i]=true;effects.push(fn);} },
  };
  const jsx = (type, props) => ({ type, props });
  const Component = moduleFrom('app/eos/components/FinanzasCuentas.tsx', {
    react, 'react/jsx-runtime': { jsx, jsxs:jsx },
    'lucide-react': new Proxy({}, {get:(_,name)=>String(name)}),
    '@/lib/finanzas/formato': {formatearMonto:(amount,currency)=>`${currency} ${amount}`},
  }, {fetch:async (_url, init) => {
    if (init?.method==='PUT') { puts.push(JSON.parse(init.body)); return {ok:true}; }
    if (failRead) throw new Error('Synthetic read failure');
    return {ok:true,json:async()=>({cuentas:rows,cobertura:{total:2,con_avisos:0,ciegas:2}})};
  }}).default;
  const render = () => { index=0;return Component({moneda:'PYG'}); };
  render();effects.splice(0).forEach(fn=>fn());await flush();let tree=render();
  if (failRead) {
    assert.ok(find(tree,n=>n.type==='button' && textOf(n)==='Decirle a EOS'));
    assert.ok(!textOf(tree).includes('No pudimos'));
    return {case:'failed_read_is_presented_as_empty_accounts', reproduced:true};
  }
  assert.ok(textOf(tree).includes('PYG 1000100'));
  find(tree,n=>n.type==='button' && textOf(n)==='Editar').props.onClick();tree=render();
  find(tree,n=>n.type==='button' && textOf(n)==='Guardar').props.onClick();await flush();
  assert.deepEqual(puts[0].cuentas.map(c=>c.moneda),['PYG','PYG']);
  return {case:'mixed_currency_total_and_currency_overwrite', reproduced:true,
    input:rows.map(c=>({moneda:c.moneda,saldo:c.saldo_declarado})),
    displayed:'PYG 1000100',savedCurrencies:puts[0].cuentas.map(c=>c.moneda)};
}
async function apiProbe({failInsert=false,invalid=false}={}) {
  let rows=[{nombre:'Existing',moneda:'USD',saldo_declarado:100}];const calls=[];
  const client={auth:{getUser:async()=>({data:{user:{id:'synthetic-user'}}})},from(table){
    return {delete(){calls.push('DELETE');return {eq:async()=>{rows=[];return {error:null};}};},
      async insert(values){calls.push('INSERT');if(failInsert)return {error:{message:'synthetic insertion failure'}};
        rows=values;return {error:null};}};
  }};
  const {PUT}=moduleFrom('app/api/finanzas/cuentas/route.ts',{
    'next/server':{NextResponse:{json:(body,init)=>Response.json(body,init)}},
    '@/lib/supabase/server':{createClient:async()=>client},
    '@/lib/fecha':{hoyEnParaguay:()=> '2026-09-08'},
  });
  const response=await PUT({json:async()=>({cuentas:[{nombre:'Existing',tipo:'banco',moneda:'USD',
    saldo_declarado:invalid?-1:100,saldo_declarado_el:'2026-08-01'}]})});
  if(failInsert){assert.equal(response.status,500);assert.equal(rows.length,0);}
  else if(invalid){assert.equal(response.status,200);assert.equal(rows.length,0);}
  else {assert.equal(rows[0].saldo_declarado_el,'2026-09-08');}
  return {case:failInsert?'insert_failure_loses_previous_accounts':invalid?'invalid_balance_silently_deletes_account':'unchanged_balance_date_reset_to_today',
    reproduced:true,httpStatus:response.status,calls,remainingRows:rows};
}
(async()=>{
  const cases=[await uiProbe(),await uiProbe(true),await apiProbe({failInsert:true}),
    await apiProbe({invalid:true}),await apiProbe()];
  process.stdout.write(JSON.stringify({method:'Actual TSX component and route, transpiled; mocked hooks, HTTP and Supabase; synthetic data only. Not browser E2E or a real database test.',cases,sources:evidence},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1;});

