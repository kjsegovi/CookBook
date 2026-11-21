import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
const container=process.argv[2];
if(!container)throw new Error('Run through npm run test:database.');
const sql=text=>execFileSync('docker',['exec',container,'psql','-U','postgres','-tA','-v','ON_ERROR_STOP=1','-c',text],{encoding:'utf8'}).trim();
const before=Number(sql('select revision from public.cookbook_meta'));
// Both tabs hold the same old revision. With rebase sync both saves apply, one after the other.
const save=(operation,checked,delay=0)=>new Promise(resolve=>{
    const text="begin; set local role authenticated; set local request.jwt.claim.sub='00000000-0000-4000-8000-000000000003'; select public.set_cookbook_flag('recipe.favorite','rice',"+checked+",'"+operation+"',"+before+"); select pg_sleep("+delay+"); commit;";
    const child=spawn('docker',['exec','-i',container,'psql','-U','postgres','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=sqlstate'],{stdio:['pipe','pipe','pipe']});
    let output='',error='';child.stdout.on('data',chunk=>{output+=chunk;});child.stderr.on('data',chunk=>{error+=chunk;});child.on('close',code=>resolve({code,output,error}));child.stdin.end(text);
});
const results=await Promise.all([save('race-favorite-a',true,0.25),save('race-favorite-b',false,0.25)]);
assert.ok(results.every(result=>result.code===0),JSON.stringify(results));
assert.equal(Number(sql('select revision from public.cookbook_meta')),before+2);
const retried=await save('race-favorite-a',true,0);
assert.equal(retried.code,0,retried.error);
assert.equal(Number(sql('select revision from public.cookbook_meta')),before+2);
assert.equal(Number(sql("select count(*) from public.cookbook_operations where id like 'race-favorite-%'")),2);
console.log('Concurrent database saves passed: both racers apply in order, duplicate retry applies once.');
