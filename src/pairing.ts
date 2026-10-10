import {SyncProblem,type Settings} from './types';

export interface PairResponse {status:number;json:unknown}
export type PairRequest=(path:string,token:string,body?:unknown)=>Promise<PairResponse>;
interface Scope {connection_id:string;project_id:string}
const valid=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const scope=(response:PairResponse):Scope=>{const value=response.json as Partial<Scope>;if(!value.connection_id||!value.project_id)throw new SyncProblem('pairing','配对信息暂不可用，请稍后重试。');return value as Scope};
const unavailable=(response:PairResponse)=>response.status>=500;
export function pairingCode(settings:Settings):string{return settings.pairingCode||settings.taskToken||settings.token||''}

// Keep existing credentials until their scopes are verified. The settings page exposes one code only.
export async function connectPairing(settings:Settings,request:PairRequest):Promise<void>{
 const code=pairingCode(settings);if(!valid(code))throw new SyncProblem('token','请填写有效的配对码。');
 const task=await request('/task-sync/v1/info',code);
 if(task.status===200){const chosen=scope(task);let removeOld=true;
  if(settings.token&&settings.token!==code){const prior=await request('/checkin-api/v1/sync/info',settings.token);if(prior.status===200){const old=scope(prior);if(old.connection_id!==chosen.connection_id||old.project_id!==chosen.project_id)throw new SyncProblem('pairing','已有授权关联不同项目，请核对配对信息后再同步。');}else if(unavailable(prior))removeOld=false;else if(prior.status!==401&&prior.status!==403)throw new SyncProblem('pairing','已有授权暂时无法核对，请稍后重试。');}
  settings.pairingCode=code;settings.pairingMode='task';if(removeOld){delete settings.token;delete settings.taskToken}return;
 }
 if(unavailable(task)&&settings.pairingMode==='task')throw new SyncProblem('unavailable','任务同步服务暂不可用，请稍后重试。');
 const checkin=await request('/checkin-api/v1/sync/info',code);
 if(checkin.status!==200){if(unavailable(task)||unavailable(checkin))throw new SyncProblem('unavailable','同步服务暂不可用，请稍后重试。');throw new SyncProblem('token','配对授权无效，请核对配对码。');}
 const original=scope(checkin);
 if(settings.taskSync){const migrated=await request('/task-sync/v1/pair','',{token:code,device_id:settings.deviceID});if(migrated.status!==201)throw new SyncProblem('unavailable','任务同步授权暂时无法连接，请稍后重试。');const next=scope(migrated);const token=(migrated.json as {token:string}).token;if(!valid(token)||next.connection_id!==original.connection_id||next.project_id!==original.project_id)throw new SyncProblem('pairing','配对信息不一致，请核对后再同步。');settings.pairingCode=token;settings.pairingMode='task';}
 else {settings.pairingCode=code;settings.pairingMode='checkin'}
 delete settings.token;delete settings.taskToken;
}
