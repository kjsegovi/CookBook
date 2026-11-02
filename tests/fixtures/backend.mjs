import { createHandler } from '../../supabase/functions/_shared/api.ts';
import { initialState } from '../../supabase/functions/_shared/domain.ts';
export const householdId='10000000-0000-4000-8000-000000000001',otherId='10000000-0000-4000-8000-000000000002';
export function fixture(role='owner', allowedOrigins=['https://kitchen.example.test']) {
    let row={state:initialState(),revision:0};
    const calls={storage:0,queries:0};
    const admin={
        auth:{getUser:async token=>({data:{user:token==='valid'?{id:'user',email_confirmed_at:'2026-11-01'}:token==='unconfirmed'?{id:'user',email_confirmed_at:null}:null},error:null})},
        from(table){
            calls.queries++;
            const filters={},query={
                select(){return query;},eq(key,value){filters[key]=value;return query;},
                update(data){query.patch=data;return query;},
                async single(){return{data:structuredClone(row),error:null};},
                async maybeSingle(){
                    if(table==='household_members')return{data:filters.household_id===householdId&&filters.user_id==='user'?{role}:null,error:null};
                    if(query.patch){if(filters.id!==householdId||filters.revision!==row.revision)return{data:null,error:null};row=structuredClone(query.patch);return{data:{revision:row.revision},error:null};}
                    return{data:structuredClone(row),error:null};
                },
            };return query;
        },
        storage:{from:()=>({upload:async()=>{calls.storage++;return{error:null};},createSignedUrl:async key=>{calls.storage++;return{data:{signedUrl:'https://photos.example.test/'+key},error:null};}})},
    };
    const handler=createHandler(admin,allowedOrigins);
    const send=async(path,{method='GET',body,token='valid',household=householdId,origin='https://kitchen.example.test',headers={}}={})=>{
        const h=new Headers(headers);if(token)h.set('authorization','Bearer '+token);if(household)h.set('x-household-id',household);if(origin)h.set('origin',origin);
        if(body!==undefined)h.set('content-type','application/json');
        const response=await handler(new Request('https://backend.example.test/functions/v1/cookbook/'+path,{method,headers:h,body:body===undefined?undefined:JSON.stringify(body)}));
        return{response,data:response.status===204?null:await response.json()};
    };
    return{send,handler,calls,get row(){return structuredClone(row);},seed(state){row.state=state;}};
}
