// Long whole-history jobs may run for more than ten minutes; only terminal jobs expire.
export function pruneJobs(jobs,now=Date.now(),maximum=300){
 for(const [id,job] of jobs)if(job.status!=='running'&&now-(job.finishedAt||job.created)>1800000)jobs.delete(id);
 if(jobs.size>maximum)for(const [id,job] of jobs){if(jobs.size<=maximum)break;if(job.status!=='running')jobs.delete(id);}
}
