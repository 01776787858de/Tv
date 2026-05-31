import urllib.request
import urllib.error
import re
import json
import os
import datetime

# 1. تحديد الملف الذي سيتم تحديثه في منصتك
FILE_NAME = 'channels.json'

# 2. الدالة الذكية للبحث عن روابط M3U8 المحمية داخل أي صفحة
def extract_m3u8_link():
    """
    هنا نضع الرابط لصفحة المباراة (الموقع الذي يعرض البث المباشر).
    لكن لأننا نجرب الآن، سأضع الرابط الذي أرسلته لي يدوياً لتكتمل التجربة.
    في المستقبل، سنجعل البايثون يقرأ صفحة المباراة ويسحب الرابط الحي هكذا:
    
    req = urllib.request.Request("رابط صفحة المباراة", headers={'User-Agent': 'Mozilla/5.0'})
    html = urllib.request.urlopen(req).read().decode('utf-8')
    match = re.search(r'(https://[^\s"\'<>]*\.m3u8\?s=[^\s"\'<>]+&e=[0-9]+)', html)
    if match: return match.group(1)
    """
    
    # نرجع الرابط الخاص بك الآن للتجربة
    return "https://rtruc7yb.12703830.net:8443/hls/ulgk1vzsw8aqr.m3u8?s=Sr3XE_T87czxFa5qJFCPaQ&e=1780259934"

# 3. سحب الرابط وتجهيز القناة
now = datetime.datetime.now().strftime("%H:%M:%S")
fresh_stream_url = extract_m3u8_link()

new_channel = {
    "name": f"⚽ بث المباراة المسحوب ({now})",
    "url": fresh_stream_url,
    "logo": "https://img.icons8.com/color/48/000000/stadium.png"
}

# 4. فتح قائمة القنوات الخاصة بك
if os.path.exists(FILE_NAME):
    with open(FILE_NAME, 'r', encoding='utf-8') as f:
        try:
            channels = json.load(f)
        except:
            channels = []
else:
    channels = []

# تنظيف القنوات المسحوبة القديمة لكي لا تتراكم وتصبح القائمة مزدحمة
channels = [c for c in channels if "⚽ بث المباراة المسحوب" not in c.get("name", "")]

# إدراج الرابط الجديد في أعلى القائمة!
channels.insert(0, new_channel)

# 5. حفظ التعديلات لكي يقوم GitHub برفعها لموقعك
with open(FILE_NAME, 'w', encoding='utf-8') as f:
    json.dump(channels, f, ensure_ascii=False, indent=2)

print(f"تم سحب الرابط بنجاح: {fresh_stream_url}")
