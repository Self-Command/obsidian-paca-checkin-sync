import {SyncProblem} from './types';
import {taskFields,type TaskSnapshot,type TaskSyncState,type TaskSyncHost,type TaskSyncServer,type TaskChange,type TaskLink,type SyncedTask} from './task-sync-types';
export function equivalent(a:unknown,b:unknown):boolean{const normal=(v:unknown):unknown=>v===''||v===undefined?null:Array.isArray(v)?[...v].sort():v;return JSON.stringify(normal(a))===JSON.stringify(normal(b))}
export function taskDiff(base:TaskSnapshot,next:TaskSnapshot):TaskSnapshot{const patch:TaskSnapshot={};for(const key of taskFields)if(!equivalent(base[key],next[key]))patch[key]=next[key]??null;return patch}
export function sharedBody(text:string):string{const stripped=text.replace(/<!-- paca-checkin:start -->[\s\S]*?<!-- paca-checkin:end -->/g,'').replace(/<!-- paca-sync-id:[a-fA-F0-9-]{36} -->/g,'');const block=/<!-- paca-task-content:start -->([\s\S]*?)<!-- paca-task-content:end -->/.exec(stripped);return(block?block[1]:stripped).trim()}
export function replaceSharedBody(text:string,body:string,syncID:string):string{const start='<!-- paca-task-content:start -->',end='<!-- paca-task-content:end -->';const markers=text.match(/<!-- paca-task-content:(start|end) -->/g)??[];if(markers.length&&(!(markers.length===2&&markers[0]===start&&markers[1]===end)))throw new SyncProblem('content','任务内容区块被修改，请核对后同步。');const replacement=`${start}\n${body}\n${end}`;if(markers.length)return text.replace(/<!-- paca-task-content:start -->[\s\S]*?<!-- paca-task-content:end -->/,replacement);const card=/<!-- paca-checkin:start -->[\s\S]*?<!-- paca-checkin:end -->/.exec(text)?.[0];return`<!-- paca-sync-id:${syncID} -->\n${replacement}\n${card?'\n'+card+'\n':''}`}
export class TaskSyncEngine{
 private running:Promise<void>|null=null;
 constructor(readonly host:TaskSyncHost,readonly server:TaskSyncServer,readonly state:TaskSyncState){}
 run():Promise<void>{if(this.running)return this.running;this.running=this.perform().finally(()=>{this.running=null});return this.running}
 async choose(id:string,keep:'local'|'server'):Promise<void>{
  const item=this.state.pending[id],link=this.state.links[id];
  const conflicts=(await this.server.conflicts()).items.filter(c=>c.sync_id===id);
  if(conflicts.length){if(!item)throw new SyncProblem('revision','请先同步最新任务，再处理冲突。');for(const conflict of conflicts)await this.server.resolve(conflict.id,keep,item.revision);for(const row of Object.values(this.state.operations))if(row.body.sync_id===id&&row.state==='conflict')row.state='pending';await this.host.save();return}
  if(!item||!link)throw new SyncProblem('missing','请先关联对应任务笔记。');const task=await this.host.task(link.path);if(!task)throw new SyncProblem('missing','对应任务笔记尚未找到。');const actual=await this.host.snapshot(task);
  if(keep==='server'){link.base=actual;await this.host.save();return}
  const target=item.deleted?crypto.randomUUID():id;const op=crypto.randomUUID();this.state.operations[op]={body:{op_id:op,sync_id:target,base_revision:item.deleted?0:item.revision,kind:item.deleted?'create':'update',base:item.deleted?{}:item.snapshot,changes:item.deleted?actual:taskDiff(item.snapshot,actual),path:task.path,note_created:task.dateCreated},state:'queued'};
  if(item.deleted){this.state.links[target]={...link,base:{},revision:0};delete this.state.links[id];delete this.state.pending[id]}await this.host.save();
 }
 async capture(kind:'create'|'update'|'delete',before:SyncedTask|undefined,after:SyncedTask|undefined,explicit?:Record<string,{before:unknown;after:unknown}>):Promise<void>{
  const task=after??before;if(!task)return;let id=Object.keys(this.state.links).find(key=>this.state.links[key].path===task.path&&this.state.links[key].created===(task.dateCreated??''));const link=id?this.state.links[id]:undefined;
  const prior=kind==='delete'?link?.base??{}:before?await this.host.snapshot(before):link?.base??{};const next=after?await this.host.snapshot(after):{};const changes=kind==='delete'?{}:taskDiff(prior,next);if(kind==='update'&&explicit){for(const key of taskFields){if(!(key in explicit)){delete changes[key];continue}prior[key]=key==='details'?sharedBody(String(explicit[key].before??'')):explicit[key].before??null;changes[key]=key==='details'?sharedBody(String(explicit[key].after??'')):explicit[key].after??null}}if(kind!=='create'&&kind!=='delete'&&!Object.keys(changes).length)return;
  if(!id){if(kind!=='create')return;id=crypto.randomUUID();this.state.links[id]={path:task.path,created:task.dateCreated??'',revision:0,base:{},sourceRef:''};}
  const base={...(link?.base??prior)};for(const key of taskFields)if(key in changes)base[key]=prior[key];const op=crypto.randomUUID();this.state.operations[op]={body:{op_id:op,sync_id:id,base_revision:link?.revision??0,kind,base,changes:kind==='create'?next:changes,path:task.path,note_created:task.dateCreated},state:'queued'};await this.host.save();
 }
 private async perform():Promise<void>{
  const info=await this.server.info();if(info.mode!=='enabled')throw new SyncProblem('disabled','双向任务同步尚未启用，请先在 Paca 确认任务清单。');
  for(const row of Object.values(this.state.operations)){
   if(row.state==='failed'||row.state==='conflict')continue;
   if(row.body.kind==='create'&&row.state==='queued'&&row.body.path&&row.body.note_created){try{const existing=await this.server.lookup(row.body.path,row.body.note_created);const old=this.state.links[row.body.sync_id];delete this.state.links[row.body.sync_id];this.state.links[existing.sync_id]={...old,revision:existing.revision,base:existing.snapshot};delete this.state.operations[row.body.op_id];await this.host.save();continue}catch(e){if(!(e instanceof SyncProblem&&e.code==='missing'))throw e}}
   if(row.state==='queued'){const submitted=await this.server.submit(row.body);row.state=submitted.state==='applied'?'pending':'pending';await this.host.save()}
   const result=await this.server.operation(row.body.op_id);if(result.state==='applied'||result.state==='superseded'){if(result.result?.sync_id&&result.result.sync_id!==row.body.sync_id){this.state.links[result.result.sync_id]=this.state.links[row.body.sync_id];delete this.state.links[row.body.sync_id];for(const queued of Object.values(this.state.operations))if(queued.body.sync_id===row.body.sync_id)queued.body.sync_id=result.result.sync_id}delete this.state.operations[row.body.op_id];await this.host.save()}else if(result.state==='conflict'||result.state==='failed'||result.state==='uncertain'){row.state=result.state==='conflict'?'conflict':'failed';row.problem=result.error??'任务操作需要核对。';await this.host.save()}
  }
  for(let page=0;page<50;page++){const feed=await this.server.changes(this.state.cursor);if(feed.next_cursor<this.state.cursor)throw new SyncProblem('feed','任务同步进度异常。');for(const item of feed.items){const prev=this.state.pending[item.sync_id];if(!prev||prev.cursor<item.cursor)this.state.pending[item.sync_id]=item}this.state.cursor=feed.next_cursor;await this.host.save();if(!feed.has_more)break;}
  for(const item of Object.values(this.state.pending)){try{if(Object.values(this.state.operations).some(op=>op.body.sync_id===item.sync_id))continue;await this.apply(item);delete this.state.pending[item.sync_id];delete this.state.problems[item.sync_id];await this.host.save()}catch(e){const message=e instanceof SyncProblem?e.userMessage:'任务暂时无法同步，请稍后重试。';this.state.problems[item.sync_id]=message;const link=this.state.links[item.sync_id];if(link)link.problem=message;await this.host.save()}}
 }
 private async locate(item:TaskChange):Promise<{task:SyncedTask;link:TaskLink}>{
  let link=this.state.links[item.sync_id];let task:SyncedTask|null=null;
  if(link?.intent){task=await this.host.find(item.sync_id);if(task){link.path=task.path;link.created=task.dateCreated??'';await this.host.save();return{task,link}}delete this.state.links[item.sync_id];link=undefined}
  if(link){task=await this.host.task(link.path);if(!task||task.dateCreated!==link.created)throw new SyncProblem('missing','任务笔记缺失或已替换，请重新关联。');return{task,link}}
  if(item.path){task=await this.host.task(item.path);if(!task||task.dateCreated!==item.note_created)throw new SyncProblem('missing','对应任务尚未到达当前设备，请等待笔记库同步。')}
  else{
   const binding=await this.server.binding(item.sync_id,'claim');if(binding.state==='bound'){task=await this.host.task(binding.path??'');if(!task||task.dateCreated!==binding.note_created)throw new SyncProblem('missing','任务已由另一设备创建，请等待笔记库同步。')}
   else if(binding.state!=='claimed')throw new SyncProblem('pending','任务创建结果正在核对，请稍后同步。');
   else{task=await this.host.find(item.sync_id);if(!task){this.state.links[item.sync_id]={path:'',created:'',revision:0,base:{},sourceRef:item.source_ref,intent:true};await this.host.save();task=await this.host.create(item.snapshot,item.sync_id)};this.state.links[item.sync_id]={path:task.path,created:task.dateCreated??'',revision:0,base:item.snapshot,sourceRef:item.source_ref,intent:true};await this.host.save();await this.server.binding(item.sync_id,'confirm',task.path,task.dateCreated??'')}
  }
  link={path:task.path,created:task.dateCreated??'',revision:0,base:item.snapshot,sourceRef:item.source_ref};this.state.links[item.sync_id]=link;await this.host.save();return{task,link}
 }
 private async apply(item:TaskChange):Promise<void>{
  if(item.warnings?.length)throw new SyncProblem('mapping',item.warnings.join(' '));
  if(item.deleted){const link=this.state.links[item.sync_id];if(!link)return;if(link.deleted)return;const task=await this.host.task(link.path);if(task){const current=await this.host.snapshot(task);if(Object.keys(taskDiff(link.base,current)).length)throw new SyncProblem('conflict','服务器删除与本地修改冲突，请先选择保留内容。');await this.host.delete(link.path)}link.deleted=true;link.revision=item.revision;return}
  const {task,link}=await this.locate(item);if(link.intent){await this.server.binding(item.sync_id,'confirm',task.path,task.dateCreated??'');link.intent=false}
  const current=await this.host.snapshot(task);const patch=taskDiff(link.base,item.snapshot);
  for(const key of taskFields)if(key in patch&&!equivalent(current[key],link.base[key])&&!equivalent(current[key],item.snapshot[key]))throw new SyncProblem('conflict',`任务在两端存在不同修改，请核对后同步。`);
  if(link.receiptRevision!==item.revision){link.receipt=undefined;link.receiptOp=undefined};link.receiptRevision=item.revision;link.receiptOp??=crypto.randomUUID();link.receipt??=(await this.server.receipt(item,link.receiptOp,Object.keys(patch).length?Object.keys(patch):['title'])).id;await this.host.save();
  const updated=Object.keys(patch).length?await this.host.update(link.path,patch,item.sync_id):task;const actual=await this.host.snapshot(updated);
  // Untouched direct Markdown edits never get uploaded as a receipt.
  for(const key of taskFields)if(key in patch&&!equivalent(actual[key],item.snapshot[key]))throw new SyncProblem('verification','任务写入尚未确认，请重新同步。');
  await this.server.ack(link.receipt,actual,updated.path,updated.dateCreated??'');link.path=updated.path;link.created=updated.dateCreated??'';link.base=item.snapshot;link.revision=item.revision;link.problem=undefined;link.receipt=undefined;link.receiptOp=undefined;this.host.bound(item.sync_id,link);
 }
}
