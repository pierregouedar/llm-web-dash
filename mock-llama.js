const http = require('http');
const fs = require('fs');
const path = require('path');
const doc = fs.readFileSync(process.argv[2], 'utf8');
const hwDir = path.dirname(process.argv[2]);
const hw = { schema_version:1, captured_at:"2026-11-06T00:00:00Z",
  memory:{capacity_bytes:34359738368},
  accelerators:[{index:0,kind:"gpu",vendor:"NVIDIA",model:"RTX 4090",memory:{kind:"gddr6",capacity_bytes:21474836480}}] };
const running = {running:[{model:"qwen2.5",state:"ready",name:"Qwen 2.5"}]};
const activity = {data:[
  {id:1,timestamp:"2026-11-06T00:00:01Z",model:"qwen2.5",tokens:{input_tokens:12,output_tokens:88,tokens_per_second:44.2,prompt_per_second:320},duration_ms:2000,state:"ready"},
  {id:2,timestamp:"2026-11-06T00:00:05Z",model:"qwen2.5",tokens:{input_tokens:20,output_tokens:110,tokens_per_second:55.0,prompt_per_second:410},duration_ms:2000,state:"ready"} ],page:1,limit:50,total:2,total_pages:1};
const models = [
  {id:"qwen2.5",name:"Qwen 2.5",description:"",state:"ready",unlisted:false,aliases:[],context_length:32768,ready_since:"2026-11-06T00:00:00Z",uptime_ms:60000,loading_progress:1,loading_message:"ready"},
  {id:"mistral",name:"Mistral 7B",description:"",state:"stopped",unlisted:false,aliases:[],context_length:8192} ];
const version = {version:"v2.69.0"};
const s = http.createServer((req,res)=>{
  const p = req.url.split('?')[0];
  if(p==='/' || p==='/index.html'){ res.setHeader('Content-Type','text/html'); return res.end(doc); }
  if(p==='/app.js'){ fs.readFile(path.join(hwDir,'app.js'),'utf8',function(e,f){ res.setHeader('Content-Type','application/javascript'); res.end(f); }); return; }
  if(p==='/config.json'){ fs.readFile(path.join(hwDir,'config.json'),'utf8',function(e,f){ res.setHeader('Content-Type','application/json'); res.end(f); }); return; }
  if(p==='/metrics'){
    res.setHeader('Content-Type','text/plain; version=0.0.4');
    res.end(
      '# HELP llamaswap_gpu_memory_used_bytes Used GPU memory\n' +
      '# TYPE llamaswap_gpu_memory_used_bytes gauge\n' +
      'llamaswap_gpu_memory_used_bytes{id="0",name="NVIDIA GeForce RTX 4090"} 18253611008\n' +
      '# HELP llamaswap_gpu_memory_total_bytes Total GPU memory\n' +
      '# TYPE llamaswap_gpu_memory_total_bytes gauge\n' +
      'llamaswap_gpu_memory_total_bytes{id="0",name="NVIDIA GeForce RTX 4090"} 21474836480\n' +
      '# HELP llamaswap_gpu_util_percent GPU utilization\n' +
      '# TYPE llamaswap_gpu_util_percent gauge\n' +
      'llamaswap_gpu_util_percent{id="0"} 96\n' +
      '# HELP llamaswap_memory_used_bytes Used system memory\n' +
      '# TYPE llamaswap_memory_used_bytes gauge\n' +
      'llamaswap_memory_used_bytes 29856411648\n' +
      '# HELP llamaswap_memory_total_bytes Total system memory\n' +
      '# TYPE llamaswap_memory_total_bytes gauge\n' +
      'llamaswap_memory_total_bytes 34359738368\n' +
      '\n# HELP llamaswap_system_cpu_percent System CPU\n# TYPE llamaswap_system_cpu_percent gauge\nllamaswap_system_cpu_percent 42\n\n'
    );
    return;
  }
  res.setHeader('Content-Type','application/json');
  if(p==='/api/hardware') res.end(JSON.stringify(hw));
  else if(p==='/running') res.end(JSON.stringify(running));
  else if(p.startsWith('/api/metrics/activity')) res.end(JSON.stringify(activity));
  else if(p==='/api/version') res.end(JSON.stringify(version));
  else if(p==='/v1/chat/completions'){ res.end(JSON.stringify({id:"x"})); }
  else if(p.startsWith('/api/models/unload')) res.end('OK');
  else if(p==='/api/events'){ res.setHeader('Content-Type','text/event-stream'); res.setHeader('Cache-Control','no-cache'); res.write('event:message\ndata:{"type":"modelStatus","data":'+JSON.stringify(models)+'}\n\n'); res.write(': keepalive\n\n'); }
  else res.writeHead(404, {'Content-Type':'application/json'}), res.end(JSON.stringify({error:'not found'}));
});
s.listen(8123,()=>console.log('mock on 8123'));
