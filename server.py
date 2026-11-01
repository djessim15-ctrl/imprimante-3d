import os, json, time, urllib.request, urllib.error
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from collections import defaultdict, deque
from pathlib import Path
ROOT=Path(__file__).resolve().parent
KEY=os.environ.get('GROQ_API_KEY','') or ((ROOT/'.groq_key').read_text().strip() if (ROOT/'.groq_key').exists() else '')
requests=defaultdict(deque)
class Handler(BaseHTTPRequestHandler):
 def do_GET(self):
  if self.path.split('?')[0] not in ('/','/index.html'):
   self.send_error(404); return
  data=(ROOT/'index.html').read_bytes(); self.send_response(200); self.send_header('Content-Type','text/html; charset=utf-8'); self.send_header('Cache-Control','no-store'); self.end_headers(); self.wfile.write(data)
 def do_POST(self):
  if self.path!='/api/chat': self.send_error(404); return
  def reply(code,obj):
   d=json.dumps(obj,ensure_ascii=False).encode(); self.send_response(code); self.send_header('Content-Type','application/json; charset=utf-8'); self.end_headers(); self.wfile.write(d)
  now=time.time(); q=requests[self.client_address[0]]
  while q and q[0]<now-60: q.popleft()
  if len(q)>=30: return reply(429,{'error':'Trop de demandes, réessaie dans une minute.'})
  q.append(now)
  try:
   size=int(self.headers.get('Content-Length','0'))
   if size<=0 or size>60000: return reply(400,{'error':'Requête invalide.'})
   body=json.loads(self.rfile.read(size)); key=body.get('key') or KEY
   if not key: return reply(400,{'error':'Renseigne ta clé Groq dans le chat.'})
   messages=body.get('messages',[])
   if not isinstance(messages,list) or len(messages)>20: return reply(400,{'error':'Conversation trop longue.'})
   payload=json.dumps({'model':os.environ.get('GROQ_MODEL','openai/gpt-oss-120b'),'messages':messages,'temperature':0.2,'reasoning_effort':'low','max_tokens':2400,'response_format':{'type':'json_object'}}).encode()
   r=urllib.request.Request('https://api.groq.com/openai/v1/chat/completions',data=payload,headers={'Authorization':'Bearer '+key,'Content-Type':'application/json','User-Agent':'curl/8.0'})
   with urllib.request.urlopen(r,timeout=50) as resp: result=json.load(resp)
   return reply(200,{'content':result['choices'][0]['message']['content']})
  except urllib.error.HTTPError as e:
   return reply(502,{'error':'Groq a refusé la demande (HTTP %d). Vérifie la clé et les limites du compte.'%e.code})
  except Exception as e: return reply(500,{'error':'Impossible de joindre l’assistant : '+str(e)[:160]})
ThreadingHTTPServer(('0.0.0.0',int(os.getenv('PORT','3000'))),Handler).serve_forever()
