import urllib.request

print("جاري جلب قائمة القنوات والمباريات العربية المحدثة...")

# أقوى رابط IPTV عربي مفتوح ومحدث على مدار الساعة (يحتوي على قنوات الرياضة والمباريات)
M3U_SOURCE = "https://raw.githubusercontent.com/TheGreatestM/Arabic-IPTV/main/Arabic_IPTV.m3u"

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
    # رابط احتياطي شغال ومباشر للبث الرياضي
    with open("live.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n#EXTINF:-1,Yalla Shoot Live Stream\nhttps://multisports.me/\n")
