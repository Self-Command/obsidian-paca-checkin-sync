export function sharedTaskTags(tags:unknown,settings:{taskTag?:string;fieldMapping?:{archiveTag?:string}}):string[]{
 const internal=new Set([settings.taskTag,settings.fieldMapping?.archiveTag].filter(Boolean).map(v=>String(v).replace(/^#/,'')));
 return [...new Set((Array.isArray(tags)?tags:[]).filter((v):v is string=>typeof v==='string').map(v=>v.replace(/^#/,'')).filter(v=>!internal.has(v)))].sort();
}
export function localTaskTags(tags:unknown,archived:boolean,settings:{taskTag?:string;taskIdentificationMethod?:string;fieldMapping?:{archiveTag?:string}}):string[]{
 const result=sharedTaskTags(tags,settings);
 if(settings.taskIdentificationMethod!=='property')result.push((settings.taskTag||'task').replace(/^#/,''));
 if(archived)result.push((settings.fieldMapping?.archiveTag||'archived').replace(/^#/,''));
 return [...new Set(result)].sort();
}
