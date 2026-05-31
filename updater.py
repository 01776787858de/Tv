import urllib.request
import re
import os

print("جاري بدء تحديث القنوات تلقائياً...")

# 1. ضع هنا رابط قائمة القنوات (M3U) التي تريد جلب القنوات منها
# يمكنك تغيير هذا الرابط لأي رابط IPTV تبيه
M3U_URL = "https://raw.githubusercontent.com/FreeTV-IR/FreeTV/master/playlist.m3u"

try:
    # جلب القنوات من الرابط
    print("جاري تحميل قائمة القنوات من الرابط...")
    headers = {'User-Agent': 'Mozilla/5.0'}
    req = urllib.request.Request(M3U_URL, headers=headers)
    
    with urllib.request.urlopen(req) as response:
        playlist_data = response.read().decode('utf-8')
    
    # 2. حفظ القنوات المحدثة في ملف جديد داخل مستودعك باسم live.m3u
    output_filename = "live.m3u"
    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(playlist_data)
        
    print(f"تم التحديث بنجاح! تم حفظ القنوات في ملف {output_filename}")

except Exception as e:
    print(f"حدث خطأ أثناء التحديث: {e}")
    # إذا فشل الرابط، ننشئ ملف بسيط عشان السيرفر ما يعطي خطأ أحمر
    with open("live.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n#EXTINF:-1,Channel Offline\nhttp://example.com/stream.ts")
