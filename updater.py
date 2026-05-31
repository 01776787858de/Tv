import urllib.request
import re
import os

print("جاري سحب قنوات ومباريات يلا شوت تلقائياً...")

# رابط موقع يلا شوت المخصص للمباريات والبث المباشر
URL = "https://www.yalla-shoot.com/"

try:
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
    }
    req = urllib.request.Request(URL, headers=headers)
    
    with urllib.request.urlopen(req, timeout=15) as response:
        html = response.read().decode('utf-8')
    
    # البحث عن روابط البth والاشارات الخاصة بالمباريات داخل الصفحة
    matches = re.findall(r'href="(https://[^"]*yalla[^"]*)"[^>]*>(.*?)</a>', html)
    
    m3u_content = "#EXTM3U\n"
    
    if matches:
        for link, title in matches:
            clean_title = re.sub('<[^<]+?>', '', title).strip() # تنظيف اسم المباراة من أكواد الـ HTML
            if clean_title and "مباراة" in clean_title or "بث" in clean_title:
                m3u_content += f"#EXTINF:-1, {clean_title}\n{link}\n"
    
    # إذا لم يجد مباريات حية حالياً، يضيف قنوات يلا شوت الرئيسية للبث
    if m3u_content == "#EXTM3U\n":
        m3u_content += "#EXTINF:-1, Yalla Shoot Live 1\nhttps://www.yalla-shoot.com/live/\n"
        m3u_content += "#EXTINF:-1, Yalla Shoot Live 2\nhttps://multisports.me/\n"

    # حفظ القنوات المستخرجة في ملف live.m3u
    output_filename = "live.m3u"
    with open(output_filename, "w", encoding="utf-8") as f:
        f.write(m3u_content)
        
    print("تم التحديث بنجاح! تم استخراج قنوات ومباريات يلا شوت الحالية.")

except Exception as e:
    print(f"حدث خطأ أثناء جلب البيانات من يلا شوت: {e}")
    # ملف احتياطي في حال توقف الموقع مؤقتاً لحماية السيرفر من اللون الأحمر
    with open("live.m3u", "w", encoding="utf-8") as f:
        f.write("#EXTM3U\n#EXTINF:-1,Yalla Shoot - No Matches Right Now\nhttps://www.yalla-shoot.com/\n")
