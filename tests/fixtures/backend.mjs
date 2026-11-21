import { createHandler } from '../../supabase/functions/_shared/api.ts';
import { initialState } from '../../supabase/functions/_shared/domain.ts';
import { applyCommand } from '../../supabase/functions/_shared/commands.ts';
import { applyStatePatch, stableJson } from '../../supabase/functions/_shared/state-patch.ts';
export const householdId='10000000-0000-4000-8000-000000000001',otherId='10000000-0000-4000-8000-000000000002';
export function fixture(_role='owner', allowedOrigins=['https://kitchen.example.test'], _legacyMemberships=[]) {
    let row={householdId,state:initialState(),revision:0}, active=true, photoBase='https://photos.example.test/';
    const photos=new Map(), applied=new Set();
    const calls={storage:0,queries:0,auth:0,reads:0,writes:0,photoBatches:0,photoPaths:[]};
    const admin={
        auth:{getUser:async token=>{
            calls.auth++;
            return{data:{user:active&&['valid','valid-second','unconfirmed'].includes(token)?{id:token==='valid-second'?'second':'user',email_confirmed_at:token==='unconfirmed'?null:'2026-11-01'}:null},error:null};
        }},
        from(table){
            calls.queries++;
            if(table!=='cookbook_meta')throw new Error('Unexpected table '+table);
            const query={select(){return query;},async single(){return{data:{household_id:householdId},error:null};}};
            return query;
        },
        async rpc(name,input={}) {
            calls.queries++;
            if(name==='read_cookbook'){
                calls.reads++;
                // Like the database, snapshots carry only the 200 most recent operation ids.
                return{data:input.known_revision===row.revision?{householdId,revision:row.revision,unchanged:true}:JSON.parse(stableJson({...row,state:{...row.state,operations:row.state.operations.slice(-200)}})),error:null};
            }
            if(name==='cookbook_operation_applied')return{data:applied.has(input.operation_id),error:null};
            if(name==='cookbook_sync_allowed')return{data:active&&input.cookbook_id===householdId&&['user','second'].includes(input.account_id),error:null};
            if(name==='write_cookbook_patch'){
                if(input.cookbook_id!==householdId)return{data:null,error:{code:'42501'}};
                if(input.expected_revision!==row.revision)return{data:null,error:null};
                if((input.patch.appendOperations??[]).some(id=>applied.has(id)))return{data:{duplicate:true,revision:row.revision},error:null};
                if(input.patch.values&&'operations' in input.patch.values)throw new Error('Operation lists are no longer stored in metadata.');
                for(const id of input.patch.appendOperations??[])applied.add(id);
                row={householdId,state:{...applyStatePatch(row.state,input.patch),operations:[...row.state.operations,...(input.patch.appendOperations??[])]},revision:row.revision+1};calls.writes++;
                return{data:{revision:row.revision},error:null};
            }
            if(name==='set_cookbook_flag'){
                if(!active)return{data:null,error:{code:'42501',message:'Sign in first.'},status:403};
                if(applied.has(input.operation_id))return{data:structuredClone(row),error:null,status:200};
                try{
                    const payload=input.command_type==='recipe.favorite'?{id:input.record_id,favorite:input.checked}:{id:input.record_id,checked:input.checked};
                    row={householdId,state:applyCommand(row.state,input.command_type,payload,input.operation_id),revision:row.revision+1};calls.writes++;applied.add(input.operation_id);
                    const collection=input.command_type==='recipe.favorite'?'recipes':'shopping';
                    return{data:{householdId,baseRevision:input.expected_revision,revision:row.revision,patch:{collections:{[collection]:{upsert:[row.state[collection].find(item=>item.id===input.record_id)],remove:[]}},values:{},appendOperations:[input.operation_id]}},error:null,status:200};
                }catch(error){return{data:null,error:{code:error.status===409?'40001':'22023',message:error.message},status:error.status};}
            }
            throw new Error('Unexpected RPC '+name);
        },
        storage:{from:()=>({
            upload:async(key,data)=>{calls.storage++;photos.set(key,new Uint8Array(data));return{error:null};},
            remove:async keys=>{for(const key of keys)photos.delete(key);return{error:null};},
            createSignedUrl:async key=>{calls.storage++;return{data:{signedUrl:photoBase+key},error:null};},
            createSignedUrls:async paths=>{calls.storage++;calls.photoBatches++;calls.photoPaths.push(paths);return{data:paths.map(path=>path.endsWith('.thumb.webp')&&!photos.has(path)?{path,error:'Missing',signedUrl:''}:{path,signedUrl:photoBase+path,error:null}),error:null};},
        })},
    };
    const handler=createHandler(admin,allowedOrigins,'synthetic-test-reminders-signing-key');
    const send=async(path,{method='GET',body,token='valid',household=householdId,origin='https://kitchen.example.test',headers={}}={})=>{
        const h=new Headers(headers);if(token)h.set('authorization','Bearer '+token);if(household)h.set('x-household-id',household);if(origin)h.set('origin',origin);
        if(body!==undefined)h.set('content-type','application/json');
        const response=await handler(new Request('https://backend.example.test/functions/v1/cookbook/'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}));
        const text=await response.text();return{response,data:text?JSON.parse(text):null};
    };
    return{send,handler,calls,admin,photos,get row(){return structuredClone(row);},seed(state){row.state=structuredClone(state);for(const id of state.operations)applied.add(id);},revoke(){active=false;},set photoBase(value){photoBase=value;}};
}
