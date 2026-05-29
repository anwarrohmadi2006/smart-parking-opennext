import urllib.request
import json
import ssl
ctx = ssl.create_default_context()
ctx.check_hostname = False
ctx.verify_mode = ssl.CERT_NONE
data = json.dumps({"observations":[{"occupancy_rate":0.87,"hour":10,"day_of_week":2,"is_weekend":0,"weather":"SUNNY"}]}).encode('utf-8')
req = urllib.request.Request('https://anwarrohmadi111--smartpark-api-web-app.modal.run/predict', data=data, headers={'Content-Type': 'application/json'}, method='POST')
try:
    print(urllib.request.urlopen(req, context=ctx).read().decode())
except Exception as e:
    print(f"Error: {e}")
