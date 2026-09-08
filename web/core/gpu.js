/** GPU geometry renderer. CPU tessellation is viewport-bounded; text is kept in
 * accessible virtual DOM rows. No React, WebGL library, or canvas text atlas. */
const COLORS=['#9f8bff','#4dcdb7','#ecb66c','#68a8f5','#e68fac','#b4d47e','#a095c9','#69bfdd'];
const rgba=hex=>[parseInt(hex.slice(1,3),16)/255,parseInt(hex.slice(3,5),16)/255,parseInt(hex.slice(5,7),16)/255,1];
export class GraphRenderer {
  constructor(canvas,onStatus=()=>{}) {this.canvas=canvas;this.onStatus=onStatus;this.mode='initializing';this.layout={nodes:[],edges:[]};this.raf=0;this.rowHeight=38;this.scrollTop=0;this.selected=-1;this.light=false;this.device=null;this.destroyed=false;}
  async init() {
    try {
      if(!navigator.gpu)throw Error('WebGPU unavailable');
      const adapter=await navigator.gpu.requestAdapter({powerPreference:'high-performance'});if(!adapter)throw Error('No GPU adapter');
      this.device=await adapter.requestDevice();if(this.destroyed){this.device.destroy();return;}this.context=this.canvas.getContext('webgpu');
      if(!this.context)throw Error('WebGPU context unavailable');
      this.format=navigator.gpu.getPreferredCanvasFormat();
      this.context.configure({device:this.device,format:this.format,alphaMode:'premultiplied'});
      const shader=this.device.createShaderModule({code:`
        struct VertexOut { @builtin(position) position: vec4f, @location(0) color: vec4f }
        @vertex fn vs(@location(0) p: vec2f, @location(1) color: vec4f) -> VertexOut {
          var out: VertexOut; out.position=vec4f(p,0.0,1.0);out.color=color;return out;
        }
        @fragment fn fs(in:VertexOut) -> @location(0) vec4f { return in.color; }
      `});
      this.pipeline=this.device.createRenderPipeline({layout:'auto',vertex:{module:shader,entryPoint:'vs',buffers:[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:'float32x2'},{shaderLocation:1,offset:8,format:'float32x4'}]}]},fragment:{module:shader,entryPoint:'fs',targets:[{format:this.format,blend:{color:{srcFactor:'src-alpha',dstFactor:'one-minus-src-alpha',operation:'add'},alpha:{srcFactor:'one',dstFactor:'one-minus-src-alpha',operation:'add'}}}]},primitive:{topology:'triangle-list'}});
      this.device.lost.then(()=>{if(!this.destroyed){this.fallback('GPU device lost');this.draw();}});
      this.device.addEventListener('uncapturederror',event=>{console.warn('Branchglass GPU:',event.error);});
      this.mode='WebGPU';this.onStatus(this.mode);this.draw();
    }catch(error){if(!this.destroyed){this.fallback(error.message);this.draw();}}
  }
  fallback(reason) {
    if(this.mode==='Canvas 2D')return;
    if(this.context){const replacement=this.canvas.cloneNode(false);this.canvas.replaceWith(replacement);this.canvas=replacement;}
    this.context=this.canvas.getContext('2d');this.mode='Canvas 2D';this.onStatus(this.mode,reason);
  }
  set(layout,scrollTop,selected,light=false){this.layout=layout;this.scrollTop=scrollTop;this.selected=selected;this.light=light;this.request();}
  request(){if(!this.destroyed&&!this.raf)this.raf=requestAnimationFrame(()=>{this.raf=0;this.draw();});}
  geometry(width,height) {
    const v=[],coords=[], scale=Math.min(21,(width-44)/Math.max(1,(this.layout.lanes||2)-1));
    const x=lane=>22+lane*scale,y=row=>row*this.rowHeight+this.rowHeight/2-this.scrollTop;
    const vertex=(px,py,c)=>v.push(px/width*2-1,1-py/height*2,...c);
    const triangle=(a,b,c,col)=>{vertex(...a,col);vertex(...b,col);vertex(...c,col);};
    const line=(a,b,color,thickness=2)=>{
      const len=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!len)return;
      const dx=-(b[1]-a[1])/len*thickness/2,dy=(b[0]-a[0])/len*thickness/2;
      triangle([a[0]+dx,a[1]+dy],[a[0]-dx,a[1]-dy],[b[0]+dx,b[1]+dy],color);
      triangle([b[0]+dx,b[1]+dy],[a[0]-dx,a[1]-dy],[b[0]-dx,b[1]-dy],color);
    };
    const circle=(cx,cy,r,c)=>{for(let i=0;i<24;i++){const a=i*Math.PI/12,b=(i+1)*Math.PI/12;triangle([cx,cy],[cx+Math.cos(a)*r,cy+Math.sin(a)*r],[cx+Math.cos(b)*r,cy+Math.sin(b)*r],c);}};
    for(const e of this.layout.edges) {
      const yy=y(e.from), ey=y(e.to);if(ey< -40||yy>height+40)continue;
      const c=rgba(COLORS[e.lane%COLORS.length]), xx=x(e.a),ex=x(e.b);
      let points;
      if(xx===ex)points=[[xx,Math.max(-20,yy)],[ex,Math.min(height+20,ey)]];
      else {
        // A quarter-turn close to the parent makes long-running lanes legible.
        const curveStart=Math.max(yy,ey-this.rowHeight*1.25);
        points=[[xx,Math.max(-20,yy)],[xx,Math.max(-20,curveStart)]];
        for(let t=1;t<=20;t++){const u=t/20;points.push([xx+(ex-xx)*(u*u*(3-2*u)),curveStart+(ey-curveStart)*u]);}
      }
      for(let i=1;i<points.length;i++)line(points[i-1],points[i],c,2);
      coords.push({type:'path',points,color:COLORS[e.lane%COLORS.length]});
    }
    const bg=rgba(this.light?'#ffffff':'#12151c');
    for(const n of this.layout.nodes) {
      const yy=y(n.index);if(yy< -10||yy>height+10)continue;
      const xx=x(n.lane),color=COLORS[n.lane%COLORS.length];
      if(n.index===this.selected){circle(xx,yy,9,[...rgba(color).slice(0,3),.23]);}
      circle(xx,yy,n.merge?5.4:4.4,rgba(color));
      if(n.merge)circle(xx,yy,2.7,bg);
      coords.push({type:'circle',x:xx,y:yy,r:n.merge?5.4:4.4,color,merge:n.merge,selected:n.index===this.selected});
    }
    return {vertices:new Float32Array(v),coords};
  }
  draw() {
    if(this.destroyed||this.mode==='initializing')return;
    const rect=this.canvas.parentElement?.getBoundingClientRect();if(!rect?.width||!rect.height)return;
    const w=rect.width,h=rect.height,dpr=Math.min(devicePixelRatio||1,2);
    if(this.canvas.width!==Math.round(w*dpr)||this.canvas.height!==Math.round(h*dpr)){this.canvas.width=Math.round(w*dpr);this.canvas.height=Math.round(h*dpr);}
    const start=performance.now(),{vertices,coords}=this.geometry(w,h);
    if(this.mode==='WebGPU') {
      if(!this.buffer||this.buffer.size<vertices.byteLength){this.buffer?.destroy();this.buffer=this.device.createBuffer({size:Math.max(4096,2**Math.ceil(Math.log2(vertices.byteLength||1))),usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});}
      if(vertices.byteLength)this.device.queue.writeBuffer(this.buffer,0,vertices);
      const encoder=this.device.createCommandEncoder();
      const pass=encoder.beginRenderPass({colorAttachments:[{view:this.context.getCurrentTexture().createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:'clear',storeOp:'store'}]});
      pass.setPipeline(this.pipeline);pass.setVertexBuffer(0,this.buffer);pass.draw(vertices.length/6);pass.end();this.device.queue.submit([encoder.finish()]);
    }else{
      const ctx=this.context;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,w,h);ctx.lineWidth=2;ctx.lineCap='round';ctx.lineJoin='round';
      for(const c of coords){if(c.type==='path'){ctx.beginPath();ctx.strokeStyle=c.color;c.points.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.stroke();}
      else{if(c.selected){ctx.beginPath();ctx.arc(c.x,c.y,9,0,Math.PI*2);ctx.fillStyle=c.color+'38';ctx.fill();}ctx.beginPath();ctx.arc(c.x,c.y,c.r,0,Math.PI*2);ctx.fillStyle=c.color;ctx.fill();if(c.merge){ctx.beginPath();ctx.arc(c.x,c.y,2.7,0,Math.PI*2);ctx.fillStyle=this.light?'#fff':'#12151c';ctx.fill();}}}
    }
    this.lastRenderMs=performance.now()-start;this.vertices=vertices.length/6;
  }
  destroy(){this.destroyed=true;cancelAnimationFrame(this.raf);this.buffer?.destroy();this.device?.destroy();}
}
