/** Explicit GitHub API integration. Tokens live only in this instance, never
 * localStorage, cookies, repository URLs, logs, or the native Git bridge. */
export class GitHubClient {
  constructor(repository,token=''){const value=repository.trim().replace(/^https:\/\/github\.com\//,'').replace(/\.git$/,'').replace(/\/$/,'');if(!/^[\w.-]+\/[\w.-]+$/.test(value))throw Error('Use an owner/repository name.');this.repository=value;this.token=token;this.base='https://api.github.com/repos/'+value;}
  async request(path,{method='GET',body}={}){const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2026-03-10'};if(this.token)headers.Authorization='Bearer '+this.token;if(body)headers['Content-Type']='application/json';const response=await fetch(this.base+path,{method,headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const data=response.status===204?null:await response.json();if(!response.ok)throw Error(`GitHub ${response.status}: ${data?.message||response.statusText}${response.status===403?' Check token permissions or API rate limits.':''}`);return data;}
  listPulls(page=1,state='open'){return this.request(`/pulls?state=${encodeURIComponent(state)}&sort=updated&per_page=30&page=${page}`);}
  pull(number){return this.request(`/pulls/${Number(number)}`);}
  files(number,page=1){return this.request(`/pulls/${Number(number)}/files?per_page=100&page=${page}`);}
  createPull(body){return this.request('/pulls',{method:'POST',body});}
  review(number,body,event='COMMENT',sha){return this.request(`/pulls/${Number(number)}/reviews`,{method:'POST',body:{body,event,...(sha?{commit_id:sha}:{})}});}
  merge(number,sha,merge_method='squash'){return this.request(`/pulls/${Number(number)}/merge`,{method:'PUT',body:{sha,merge_method}});}
  issues(page=1){return this.request(`/issues?state=open&per_page=30&page=${page}`).then(rows=>rows.filter(r=>!r.pull_request));}
  createIssue(body){return this.request('/issues',{method:'POST',body});}
  runs(page=1){return this.request(`/actions/runs?per_page=30&page=${page}`).then(r=>r.workflow_runs);}
  rerun(id){return this.request(`/actions/runs/${Number(id)}/rerun`,{method:'POST'});}
  cancel(id){return this.request(`/actions/runs/${Number(id)}/cancel`,{method:'POST'});}
}
