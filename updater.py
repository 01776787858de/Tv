import urllib.request
import os

print("جاري جلب قائمة مباريات وقنوات يلا شوت المحدثة...")

# رابط مباشر ومفتوح لقنوات يلا شوت وبين سبورت للمباريات
M3U_SOURCE = "https://raw.githubusercontent.com/arabianiptv/ArabianIPTV/master/yalla_shoot.m3u"

try:
    headers = {'User-Agent': 'Mozilla/5.0'}
    req = urllib.request.Request(M3U_SOURCE, headers=headers)
    
    with urllib.request.urlopen(req, timeout=15) as response:
        playlist_data = response.read().decode('utf-8')
    
    # حفظ القنوات في ملفك live.m3u
    output_filename = "live.m3u"
    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(playlist_data)
        
    print("تم التحديث بنجاح! القنوات جاهزة داخل ملف live.m3u")

except Exception as e:
    print(f"حدث خطأ: {e}")
    # ملف احتياطي دائم بملخص قنوات يلا شوت
    with open("live.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n#EXTINF:-1,Yalla Shoot Main Stream\nhttps://multisports.me/\n")
