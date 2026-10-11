import test from 'node:test';
import assert from 'node:assert/strict';
import {TaskSyncEngine,sharedBody,replaceSharedBody} from '../src/task-sync-engine';
import {emptyTaskState,type SyncedTask,type TaskSnapshot,type TaskChange,type TaskSyncHost,type TaskSyncServer,type TaskOperation} from '../src/task-sync-types';
import {SyncProblem} from '../src/types';

function fixture(){
 const id='11111111-1111-4111-8111-111111111111';const state=emptyTaskState();const tasks=new Map<string,SyncedTask>();const item:TaskChange={cursor:1,sync_id:id,task_id:'core-task',revision:1,kind:'task',deleted:false,path:'',note_created:'',source_ref:'sync:'+id,snapshot:{title:'Paca 创建任务',status:'open',priority:'normal',details:'普通内容',scheduled:'2026-10-09T09:00:00',due:'2026-10-09T10:00:00',archived:false,tags:['学习']}};
 let created=0,written=0,removed=0,pulls=0,saves=0,lostCreate=false;const submitted:TaskOperation[]=[];const acknowledgments:TaskSnapshot[]=[];let binding={state:'unbound',path:'',note_created:''};
 const host:TaskSyncHost={task:async path=>tasks.get(path)??null,find:async marker=>[...tasks.values()].find(t=>t.marker===marker)??null,create:async(snapshot,marker)=>{created++;const task={...snapshot,path:'Tasks/来自 Paca.md',dateCreated:'2026-10-08T00:00:00Z',marker};tasks.set(task.path,task);if(lostCreate){lostCreate=false;throw Error('created note, result lost')}return task},update:async(path,patch)=>{written++;const task=tasks.get(path)!;Object.assign(task,patch);return task},delete:async path=>{removed++;tasks.delete(path)},snapshot:async task=>{const result:Record<string,unknown>={...task};delete result.path;delete result.dateCreated;delete result.marker;return result as TaskSnapshot},save:async()=>{saves++},bound:()=>{}};
 const server:TaskSyncServer={info:async()=>({mode:'enabled'}),changes:async cursor=>{pulls++;return {items:cursor<item.cursor?[structuredClone(item)]:[],next_cursor:Math.max(item.cursor,cursor),has_more:false,mode:'enabled'}},binding:async(_id,action,path,birth)=>{if(binding.state==='bound')return binding;if(action==='claim'){binding.state='creating';return{state:'claimed'}}binding={state:'bound',path:path!,note_created:birth!};return binding},submit:async op=>{submitted.push(structuredClone(op));return{state:'pending'}},operation:async()=>({state:'pending'}),receipt:async(_item,op)=>({id:op}),ack:async(_receipt,snapshot)=>{acknowledgments.push(structuredClone(snapshot))},lookup:async()=>{throw new SyncProblem('missing','not imported')},conflicts:async()=>({items:[]}),resolve:async()=>{}};
 const preferences:{syncPriority:'latest'|'server'|'local'}={syncPriority:'server'};return {id,state,tasks,item,host,server,preferences,engine:new TaskSyncEngine(host,server,state,preferences),submitted,acknowledgments,counts:()=>({created,written,removed,pulls,saves}),loseCreate:()=>{lostCreate=true}};
}

test('Paca task creates a note without check-in; manual and auto share one run',async()=>{const f=fixture();await Promise.all([f.engine.run(),f.engine.run()]);assert.equal(f.counts().created,1);assert.equal(f.counts().pulls,2);assert.equal(f.state.links[f.id].revision,1);assert.equal(f.tasks.size,1);await f.engine.run();assert.equal(f.counts().created,1)});
test('result lost after note creation is recovered through marker before creating again',async()=>{const f=fixture();f.loseCreate();await f.engine.run();assert.equal(f.tasks.size,1);assert.equal(f.state.links[f.id].intent,true);assert(f.state.problems[f.id]);await f.engine.run();assert.equal(f.counts().created,1);assert.equal(f.state.links[f.id].intent,false);assert.deepEqual(f.state.problems,{})});
test('missing note is visible and never silently recreated',async()=>{const f=fixture();await f.engine.run();f.tasks.clear();f.item.cursor++;f.item.revision++;f.item.snapshot.title='改名';await f.engine.run();assert.equal(f.counts().created,1);assert.match(f.state.problems[f.id],/缺失/) });
test('server changes another field; hand-written Markdown time remains local',async()=>{const f=fixture();await f.engine.run();const note=[...f.tasks.values()][0];note.scheduled='2026-11-01T12:00:00';f.item.cursor++;f.item.revision++;f.item.snapshot.priority='high';await f.engine.run();assert.equal(note.scheduled,'2026-11-01T12:00:00');assert.equal(note.priority,'high');assert.equal(f.state.links[f.id].base.scheduled,'2026-10-09T09:00:00');assert.equal(f.acknowledgments.at(-1)!.scheduled,'2026-11-01T12:00:00','actual write was fabricated in receipt')});
test('UI priority mutation queues exactly that field after a manual date edit',async()=>{const f=fixture();await f.engine.run();const note=[...f.tasks.values()][0];const before={...note,scheduled:'2026-11-01T12:00:00'};const after={...before,priority:'high'};await f.engine.capture('update',before,after,{priority:{before:'normal',after:'high'}});const operation=Object.values(f.state.operations)[0];assert.deepEqual(operation.body.changes,{priority:'high'});assert.equal(operation.body.base.scheduled,'2026-10-09T09:00:00')});
test('a server deletion is not blocked by an outdated template snapshot',async()=>{const f=fixture();await f.engine.run();const note=[...f.tasks.values()][0];note.details='课表说明与完成标准';f.item.cursor++;f.item.revision++;f.item.deleted=true;await f.engine.run();assert.equal(f.counts().removed,1);assert.deepEqual(f.state.problems,{});await f.engine.run();assert.equal(f.counts().removed,1)});

test('server priority resolves the changed field while preserving an unrelated local field',async()=>{const f=fixture();await f.engine.run();const note=[...f.tasks.values()][0];note.title='本地标题';note.scheduled='2026-11-01T12:00:00';f.item.cursor++;f.item.revision++;f.item.snapshot.title='服务器标题';await f.engine.run();assert.equal(note.title,'服务器标题');assert.equal(note.scheduled,'2026-11-01T12:00:00');assert.deepEqual(f.state.problems,{})});

test('Obsidian priority uploads the overlapping field but still accepts unrelated Paca changes',async()=>{const f=fixture();f.preferences.syncPriority='local';await f.engine.run();const note=[...f.tasks.values()][0];note.title='本地标题';f.item.cursor++;f.item.revision++;f.item.snapshot.title='服务器标题';f.item.snapshot.priority='high';await f.engine.run();assert.equal(note.title,'本地标题');assert.equal(note.priority,'high');assert.deepEqual(f.state.problems,{});const op=Object.values(f.state.operations)[0];assert.deepEqual(op.body.changes,{title:'本地标题'});await f.engine.run();assert.equal(f.submitted.at(-1)?.prefer,'local')});

test('a legacy conflict resolves automatically and restores an explicitly rejected local delete',async()=>{const f=fixture();await f.engine.run();const note=[...f.tasks.values()][0];await f.engine.capture('delete',note,undefined);f.tasks.delete(note.path);const row=Object.values(f.state.operations)[0];row.state='conflict';f.item.cursor++;f.item.revision++;f.item.snapshot.title='服务器保留的修改';let resolved=false,restored=false;f.server.conflicts=async()=>({items:resolved?[]:[{id:'conflict',sync_id:f.id,revision:f.item.revision,base_revision:1,base:row.body.base,local:{},remote:f.item.snapshot,fields:['delete']}]});f.server.resolve=async(_id,keep,revision)=>{assert.equal(keep,'server');assert.equal(revision,f.item.revision);resolved=true};f.server.operation=async()=>({state:'superseded'});f.server.binding=async(_id,action)=>{if(action==='restore'){restored=true;return{state:'claimed'}}if(action==='confirm'){f.item.cursor++;f.item.revision++;f.item.path=note.path;f.item.note_created=note.dateCreated!;return{state:'bound'}}return{state:'bound',path:note.path,note_created:note.dateCreated}};await f.engine.run();assert(resolved&&restored);await f.engine.run();assert.equal([...f.tasks.values()][0].title,'服务器保留的修改');assert.deepEqual(f.state.problems,{});assert.equal(f.counts().created,2)});

test('an unrecorded body difference does not override a server delete even in Obsidian priority',async()=>{const f=fixture();f.preferences.syncPriority='local';await f.engine.run();[...f.tasks.values()][0].details='模板填充造成的历史差异';f.item.cursor++;f.item.revision++;f.item.deleted=true;await f.engine.run();assert.equal(f.counts().removed,1);assert.equal(Object.keys(f.state.operations).length,0)});

for(const priority of ['latest','server','local'] as const){
 test(`${priority}: offline edit then delete bases deletion on its own queued changes`,async()=>{const f=fixture();f.preferences.syncPriority=priority;await f.engine.run();const task=[...f.tasks.values()][0];for(const title of ['连续修改 B','连续修改 C']){const before={...task};task.title=title;await f.engine.capture('update',before,task,{title:{before:before.title,after:title}})}await f.engine.capture('delete',task,undefined);const rows=Object.values(f.state.operations);assert.equal(rows.length,3);assert.equal(rows[2].body.base.title,'连续修改 C');assert.equal(rows[2].body.base.details,f.item.snapshot.details);await f.engine.run();assert(rows.every(row=>row.sealed&&row.body.prefer===priority))});
 test(`${priority}: received operation keeps its exact body when preference changes`,async()=>{const f=fixture();f.preferences.syncPriority=priority;await f.engine.run();const task=[...f.tasks.values()][0],before={...task};task.priority='high';await f.engine.capture('update',before,task,{priority:{before:'normal',after:'high'}});f.server.submit=async op=>{f.submitted.push(structuredClone(op));throw Error('response lost')};await assert.rejects(f.engine.run());f.preferences.syncPriority=priority==='server'?'local':'server';await assert.rejects(f.engine.run());assert.deepEqual(f.submitted[0],f.submitted[1]);assert.equal(f.submitted[1].prefer,priority)});
}

for(const priority of ['latest','server'] as const)test(`${priority}: rejected queued edit converges when server reverted to the old base`,async()=>{const f=fixture();f.preferences.syncPriority=priority;await f.engine.run();const task=[...f.tasks.values()][0],before={...task};task.title='离线标题';await f.engine.capture('update',before,task,{title:{before:before.title,after:task.title}});f.server.operation=async()=>({state:'superseded'});f.item.cursor++;f.item.revision++;await f.engine.run();assert.equal(task.title,f.item.snapshot.title);assert.equal(Object.keys(f.state.operations).length,0);assert.equal(f.state.links[f.id].reconcileFields,undefined);assert.deepEqual(f.state.problems,{})});
test('a second client waits for the existing binding and does not create duplicates',async()=>{const f=fixture();f.server.binding=async()=>({state:'bound',path:'Tasks/另一个设备.md',note_created:'2026-10-08T00:00:00Z'});await f.engine.run();assert.equal(f.counts().created,0);assert.match(f.state.problems[f.id],/另一设备/)});
test('unsupported rich text is visible and never overwritten with empty content',async()=>{const f=fixture();f.item.warnings=['原始内容暂不支持'];await f.engine.run();assert.equal(f.tasks.size,0);assert.match(f.state.problems[f.id],/原始内容/)});
test('ordinary content excludes check-in images and preserves private blocks on replacement',()=>{const input='<!-- paca-sync-id:11111111-1111-4111-8111-111111111111 -->\n<!-- paca-task-content:start -->\n旧内容\n<!-- paca-task-content:end -->\n私人笔记\n<!-- paca-checkin:start -->\n![[PushGo附件/a.jpg]]\n<!-- paca-checkin:end -->';assert.equal(sharedBody(input),'旧内容');const updated=replaceSharedBody(input,'新内容','11111111-1111-4111-8111-111111111111');assert(updated.includes('私人笔记'));assert(updated.includes('![[PushGo附件/a.jpg]]'));assert.equal(sharedBody(updated),'新内容')});


test('UI rename retains association when the former path no longer exists',async()=>{const f=fixture();await f.engine.run();const original=[...f.tasks.values()][0];const before={...original};f.tasks.delete(before.path);const renamed={...original,path:'Tasks/修改标题.md',title:'修改标题'};f.tasks.set(renamed.path,renamed);f.host.snapshot=async t=>{if(!f.tasks.has(t.path))throw Error('old note path is gone');return {...t} as TaskSnapshot};await f.engine.capture('update',before,renamed,{title:{before:before.title,after:renamed.title}});const operation=Object.values(f.state.operations)[0];assert.equal(operation.body.sync_id,f.id);assert.equal(f.state.links[f.id].path,renamed.path);assert.deepEqual(operation.body.changes,{title:'修改标题'})});

test('cache-created echoes and normalized tag refreshes do not queue user operations',async()=>{const f=fixture();await f.engine.run();const task=[...f.tasks.values()][0];await f.engine.capture('create',undefined,task);await f.engine.capture('update',task,task,{tags:{before:['学习'],after:['学习']}});assert.equal(Object.keys(f.state.operations).length,0)});

test('body edits after template creation are recorded offline once and survive an API echo',async()=>{const f=fixture();await f.engine.run();const task=[...f.tasks.values()][0];task.details='补齐的课程说明';await f.engine.captureBody(task.path);const queued=Object.values(f.state.operations);assert.equal(queued.length,1);assert.deepEqual(queued[0].body.changes,{details:'补齐的课程说明'});await f.engine.captureBody(task.path);assert.equal(Object.keys(f.state.operations).length,1)});

test('a never-submitted create reads the final body and seals it before network access',async()=>{const f=fixture();const task={path:'Tasks/离线新建.md',dateCreated:'2026-10-08T00:00:00Z',title:'离线任务',details:'空白模板'};f.tasks.set(task.path,task);await f.engine.capture('create',undefined,task);task.details='最终任务说明';let lose=true;f.server.submit=async op=>{f.submitted.push(structuredClone(op));if(lose){lose=false;throw Error('response lost')}return{state:'pending'}};await assert.rejects(f.engine.run());assert.equal(f.submitted[0].changes.details,'最终任务说明');task.details='后来又修改';await f.engine.run();assert.deepEqual(f.submitted[0],f.submitted[1],'reusing an operation id changed its body after an unknown result')});

test('an existing imported creation keeps the later filled body as an update',async()=>{const f=fixture();const task={path:'Tasks/接入任务.md',dateCreated:'2026-10-08T00:00:00Z',title:'接入任务',details:'空白模板'};f.tasks.set(task.path,task);await f.engine.capture('create',undefined,task);task.details='任务创建后补齐的正文';f.server.lookup=async()=>({sync_id:f.id,revision:1,snapshot:{title:task.title,details:'空白模板'}});await f.engine.run();const update=Object.values(f.state.operations)[0];assert.equal(update.body.kind,'update');assert.equal(update.body.sync_id,f.id);assert.deepEqual(update.body.changes,{details:'任务创建后补齐的正文'});assert.equal(update.body.base.details,'空白模板')});

test('shared body comparisons ignore line-ending differences',()=>{assert.equal(sharedBody('正文\r\n\r\n<!-- paca-checkin:start -->\r\n照片\r\n<!-- paca-checkin:end -->'),sharedBody('正文\n\n<!-- paca-checkin:start -->\n照片\n<!-- paca-checkin:end -->'))});

test('a crash after write but before receipt acknowledgment does not create a false conflict',async()=>{
 const f=fixture();await f.engine.run();const acknowledge=f.server.ack;let lost=true;
 f.server.ack=async(...args)=>{if(lost){lost=false;throw Error('response lost')}return acknowledge(...args)};
 f.item.cursor++;f.item.revision++;f.item.snapshot.title='第一次服务器修改';await f.engine.run();
 assert(f.state.links[f.id].receiptExpected);assert.equal([...f.tasks.values()][0].title,'第一次服务器修改');
 f.item.cursor++;f.item.revision++;f.item.snapshot.priority='high';await f.engine.run();
 assert.deepEqual(f.state.problems,{});assert.equal([...f.tasks.values()][0].title,'第一次服务器修改');assert.equal([...f.tasks.values()][0].priority,'high');assert.equal(f.state.links[f.id].revision,3);
});

test('an official materialized occurrence uses the shared server date identity',async()=>{
 const f=fixture();await f.engine.run();
 const child={path:'Tasks/本期阅读.md',dateCreated:'2026-10-08T01:00:00Z',title:'本期阅读',recurrence_parent:f.id,occurrence_date:'2026-10-09',status:'open'};
 await f.engine.capture('create',undefined,child);
 const first=Object.values(f.state.operations)[0];assert.notEqual(first.body.sync_id,f.id);assert.equal(first.body.changes.recurrence_parent,f.id);assert.equal(first.body.changes.occurrence_date,'2026-10-09');
 await f.engine.capture('create',undefined,child);assert.equal(Object.keys(f.state.operations).length,1,'Metadata echo duplicated the same period');
});

test('a materialized child replaces its inherited mother marker and retains private notes',()=>{
 const mother='11111111-1111-4111-8111-111111111111',child='22222222-2222-4222-8222-222222222222';
 const inherited=`<!-- paca-sync-id:${mother} -->\n<!-- paca-task-content:start -->\n母任务正文\n<!-- paca-task-content:end -->\n私人记录`;
 const result=replaceSharedBody(inherited,'本期正文',child);
 assert(result.includes(`<!-- paca-sync-id:${child} -->`));assert(!result.includes(`<!-- paca-sync-id:${mother} -->`));assert.equal(sharedBody(result),'本期正文');assert(result.includes('私人记录'));
});


test('canonical period association moves every queued edit to the preserved task',async()=>{
 const f=fixture();await f.engine.run();
 const child={path:'Tasks/离线周期.md',dateCreated:'2026-10-08T01:00:00Z',title:'离线周期',status:'open',recurrence_parent:f.id,occurrence_date:'2026-10-09'};
 await f.engine.capture('create',undefined,child);
 await f.engine.capture('update',child,{...child,title:'第一次修改'},{title:{before:child.title,after:'第一次修改'}});
 await f.engine.capture('update',{...child,title:'第一次修改'},{...child,title:'第二次修改'},{title:{before:'第一次修改',after:'第二次修改'}});
 const queued=Object.values(f.state.operations),create=queued[0].body.op_id,canonical='33333333-3333-4333-8333-333333333333';
 f.server.operation=async id=>id===create?{state:'superseded',result:{sync_id:canonical}}:{state:'pending'};
 await f.engine.run();
 assert.equal(Object.keys(f.state.operations).length,2);
 assert(Object.values(f.state.operations).every(row=>row.body.sync_id===canonical));
 assert.equal(f.state.links[canonical].path,child.path);
});
