/** Minimal promise-based Node fs adapter for isomorphic-git over the File System
 * Access API / OPFS. Paths are confined to the explicitly granted directory. */
export class HandleFS {
  constructor(root){this.root=root;this.promises=this;}
  parts(path){const parts=String(path).replace(/\\/g,'/').split('/').filter(x=>x&&x!=='.');if(parts.includes('..')||parts.some(x=>x.includes('\0')))throw this.error('EACCES',path);return parts;}
  error(code,path){const e=new Error(`${code}: ${path}`);e.code=code;return e;}
  async parent(path,create=false){const p=this.parts(path),name=p.pop();let dir=this.root;try{for(const part of p)dir=await dir.getDirectoryHandle(part,{create});return {dir,name};}catch(e){throw this.error(e.name==='NotFoundError'?'ENOENT':e.name==='NotAllowedError'?'EACCES':'ENOTDIR',path);}}
  async handle(path){if(!this.parts(path).length)return this.root;const {dir,name}=await this.parent(path);try{return await dir.getFileHandle(name);}catch(e){try{return await dir.getDirectoryHandle(name);}catch{throw this.error('ENOENT',path);}}}
  async readFile(path,options){const h=await this.handle(path);if(h.kind!=='file')throw this.error('EISDIR',path);const file=await h.getFile();const bytes=new Uint8Array(await file.arrayBuffer());return typeof options==='string'||options?.encoding?new TextDecoder().decode(bytes):bytes;}
  async writeFile(path,data,options){const {dir,name}=await this.parent(path);try{if(options?.flag==='wx'){try{await dir.getFileHandle(name);throw this.error('EEXIST',path);}catch(e){if(e.code==='EEXIST')throw e;if(e.name!=='NotFoundError')throw e;}}const h=await dir.getFileHandle(name,{create:true});const w=await h.createWritable();await w.write(data);await w.close();}catch(e){if(e.code)throw e;throw this.error(e.name==='NotAllowedError'?'EACCES':'EIO',path);}}
  async mkdir(path,options){if(!this.parts(path).length)return;const {dir,name}=await this.parent(path,options?.recursive);try{await dir.getDirectoryHandle(name);if(!options?.recursive)throw this.error('EEXIST',path);}catch(e){if(e.code)throw e;await dir.getDirectoryHandle(name,{create:true});}}
  async readdir(path){const h=await this.handle(path);if(h.kind!=='directory')throw this.error('ENOTDIR',path);const entries=[];for await(const name of h.keys())entries.push(name);return entries.sort();}
  async unlink(path){const {dir,name}=await this.parent(path);try{await dir.removeEntry(name);}catch{throw this.error('ENOENT',path);}}
  async rmdir(path){return this.unlink(path);}
  async stat(path){const h=await this.handle(path),dir=h.kind==='directory';const f=dir?null:await h.getFile(),time=f?.lastModified||0;return {type:dir?'dir':'file',size:f?.size||0,mode:dir?0o40755:0o100644,mtimeMs:time,ctimeMs:time,atimeMs:time,birthtimeMs:time,mtime:new Date(time),ctime:new Date(time),atime:new Date(time),uid:0,gid:0,ino:0,dev:0,isFile:()=>!dir,isDirectory:()=>dir,isSymbolicLink:()=>false};}
  async lstat(path){return this.stat(path);}
  async readlink(path){throw this.error('ENOTSUP',path);}
  async symlink(target,path){throw this.error('ENOTSUP',path);}
  async chmod(){/* Browser directory handles cannot alter POSIX permissions. */}
  async rename(from,to){const bytes=await this.readFile(from);await this.writeFile(to,bytes);await this.unlink(from);}
}
