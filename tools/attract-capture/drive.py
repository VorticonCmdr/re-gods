import json, time, urllib.request, os
API = 'http://localhost:8386/api/v1/script/'
NAMES = {1: 'joyl1', 2: 'joyg1', 3: 'joyl2', 4: 'joyg2', 5: 'joyl3', 0: 'joyg3'}
src = open('capture.lua').read()
def call(p, body=None, text=None):
    if text is not None:
        req = urllib.request.Request(API + p, data=text.encode(), headers={'Content-Type': 'text/plain'}, method='POST')
    elif body is not None:
        req = urllib.request.Request(API + p, data=b'', method='POST')
    else:
        req = urllib.request.Request(API + p)
    return json.load(urllib.request.urlopen(req, timeout=10))
have = {n for n in NAMES.values() if os.path.exists(n + '.raw.json')}
while len(have) < 6:
    time.sleep(2.5)
    try: call('stop', body={})
    except Exception as e: pass
    for attempt in range(20):
        try:
            print('load', call('load?name=cap', text=src), flush=True)
            time.sleep(0.5)
            print('start', call('start', body={}), flush=True)
            break
        except Exception as e:
            print('retry', e, flush=True); time.sleep(3)
    while True:
        time.sleep(2)
        try: st = call('status')
        except Exception as e: print('status retry', e, flush=True); continue
        if st.get('state') in ('completed', 'error'): break
    if st.get('state') == 'error': print('ERR', st, flush=True); continue
    name = NAMES[st['output']['cycler']]
    json.dump(st, open(name + '.raw.json', 'w'))
    have.add(name)
    print('saved', name, st['output']['n'], flush=True)
print('done', flush=True)
