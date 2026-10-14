import {PGlite} from '@electric-sql/pglite';
import {btree_gist} from '@electric-sql/pglite/contrib/btree_gist';
import {readdir,readFile} from 'node:fs/promises';
export async function assistantDatabase() {
 const pg=new PGlite({extensions:{btree_gist}});
 await pg.exec(`create schema auth; create role anon; create role authenticated; create role service_role;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
 create function auth.role() returns text language sql stable as 'select current_setting(''request.jwt.claim.role'',true)';
 set request.jwt.claim.role='service_role';`);
 for(const filename of (await readdir('supabase/migrations')).filter(f=>f.endsWith('.sql')).sort()) {
  try{await pg.exec(await readFile(`supabase/migrations/${filename}`,'utf8'));}catch(e){throw new Error(`${filename}: ${e.message}`);}
 }
 const db={
  async rpc(name,args={}) {
   try {const vals=Object.values(args);const params=Object.keys(args).map((k,i)=>`${k} => $${i+1}`).join(',');
    const result=await pg.query(`select to_jsonb(public.${name}(${params})) as result`,vals);return {data:result.rows[0]?.result,error:null};
   }catch(e){return {data:null,error:{code:e.code,message:e.message}};}
  },
  from(table){
   let cols='*',where=[],values=[],orders=[],limit=null,action='select',fields={},returning=false;
   const safe=x=>{if(!/^[\w,* ]+$/.test(x))throw new Error('Unsafe test identifier');return x;};
   const bind=x=>{values.push(x);return `$${values.length}`;};
   const q={
    select(s='*'){cols=safe(s);returning=action!=='select';return q;},
    eq(k,v){where.push(`${safe(k)}=${bind(v)}`);return q;},neq(k,v){where.push(`${safe(k)}<>${bind(v)}`);return q;},
    in(k,vs){where.push(`${safe(k)} in (${vs.map(bind).join(',')})`);return q;},
    order(k,opt={}){orders.push(`${safe(k)} ${opt.ascending===false?'desc':'asc'}`);return q;},limit(n){limit=n;return q;},
    insert(f){action='insert';fields=f;return q;},update(f){action='update';fields=f;return q;},delete(){action='delete';return q;},
    async execute(single=false){try {
     let sql;
     if(action==='select')sql=`select ${cols} from public.${safe(table)}`;
     else if(action==='insert')sql=`insert into public.${safe(table)} (${Object.keys(fields).map(safe).join(',')}) values (${Object.values(fields).map(bind).join(',')})`;
     else if(action==='update')sql=`update public.${safe(table)} set ${Object.entries(fields).map(([k,v])=>`${safe(k)}=${bind(v)}`).join(',')}`;
     else sql=`delete from public.${safe(table)}`;
     if(where.length)sql+=` where ${where.join(' and ')}`;
     if(action==='select'){if(orders.length)sql+=` order by ${orders.join(',')}`;if(limit!==null)sql+=` limit ${limit}`;}
     else if(returning)sql+=` returning ${cols}`;
     const r=await pg.query(sql,values);return {data:single?r.rows[0]||null:r.rows,error:null};
    }catch(e){return {data:null,error:{code:e.code,message:e.message}};}},
    maybeSingle(){return q.execute(true);},single(){return q.execute(true);},then(resolve,reject){return q.execute().then(resolve,reject);},
   };return q;
  }
 };
 return {pg,db};
}
